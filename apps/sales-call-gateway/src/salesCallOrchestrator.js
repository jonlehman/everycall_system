import {
  SalesCallOrchestrationError,
  deriveSalesCommandId,
  encodeSalesClientState,
  requireSalesValue,
  summarizeSalesProviderError
} from "./salesCallProviderUtils.js";
import { salesTelnyxCallPatch } from "./salesTelnyxClient.js";

// The persistent sales gateway owns this human-first conference lifecycle.

function firstValue(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function normalizedOperator(operator = {}) {
  return {
    call_control_id: firstValue(
      operator.call_control_id,
      operator.callControlId,
      operator.operator_call_control_id
    ),
    call_leg_id: firstValue(
      operator.call_leg_id,
      operator.callLegId,
      operator.operator_leg_id
    ),
    call_session_id: firstValue(
      operator.call_session_id,
      operator.callSessionId,
      operator.operator_session_id
    )
  };
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : Date.now();
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function conferenceNameFor(salesCallId, supplied) {
  const normalized = String(supplied || "").trim();
  if (normalized) return normalized.slice(0, 120);
  const safeId = String(salesCallId).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 96);
  return `sales-${safeId}`;
}

function fulfilledValue(result) {
  return result?.status === "fulfilled" ? result.value : null;
}

function rejectedReason(result) {
  return result?.status === "rejected" ? result.reason : null;
}

function settledSummary(action, result) {
  if (result.status === "fulfilled") return { action, status: "fulfilled" };
  return {
    action,
    status: "rejected",
    error: String(result.reason?.message || result.reason || "failed").slice(0, 500)
  };
}

export function createInMemorySalesRealtimeRegistry() {
  const controllers = new Map();
  return {
    get(salesCallId) {
      return controllers.get(String(salesCallId)) || null;
    },
    set(salesCallId, controller) {
      controllers.set(String(salesCallId), controller);
      return controller;
    },
    delete(salesCallId) {
      return controllers.delete(String(salesCallId));
    },
    size() {
      return controllers.size;
    }
  };
}

export function createSalesCallOrchestrator({
  telnyx,
  xai,
  realtimeRegistry = createInMemorySalesRealtimeRegistry(),
  participantJoinWaiter = null,
  now = Date.now,
  logger = null
}) {
  if (!telnyx || !xai) throw new Error("sales_telephony_clients_required");

  function log(level, event, fields = {}) {
    if (!logger) return;
    const method = typeof logger[level] === "function" ? logger[level] : logger.log;
    if (typeof method === "function") method.call(logger, event, fields);
  }

  function commandId(correlationId, operation, target = "") {
    return deriveSalesCommandId({ correlationId, operation, target });
  }

  async function closeRuntime(salesCallId) {
    const controller = await realtimeRegistry.get(salesCallId);
    if (controller) {
      try {
        controller.close();
      } catch {
        // Provider teardown remains authoritative if local socket close fails.
      }
    }
    await realtimeRegistry.delete(salesCallId);
  }

  async function teardownAIOnly({
    salesCallId,
    correlationId,
    conferenceId,
    aiTelnyxCallControlId,
    xaiCallId,
    leaveConference = true
  }) {
    const selectedCorrelationId = correlationId || salesCallId;
    const actions = [];
    const controller = await realtimeRegistry.get(salesCallId);
    if (controller?.isOpen) {
      actions.push({
        action: "pause_ai",
        run: async () => controller.pause()
      });
    }
    if (leaveConference && conferenceId && aiTelnyxCallControlId) {
      actions.push({
        action: "leave_ai_from_conference",
        run: () => telnyx.leaveConference({
          conferenceId,
          callControlId: aiTelnyxCallControlId,
          commandId: commandId(selectedCorrelationId, "leave_ai_conference", aiTelnyxCallControlId)
        })
      });
    }

    const preHangup = await Promise.allSettled(actions.map((entry) => entry.run()));
    const hangupActions = [];
    if (xaiCallId) {
      hangupActions.push({
        action: "hangup_xai",
        run: () => xai.hangupCall({
          callId: xaiCallId,
          clientRequestId: commandId(selectedCorrelationId, "hangup_xai", xaiCallId)
        })
      });
    }
    if (aiTelnyxCallControlId) {
      hangupActions.push({
        action: "hangup_ai_telnyx",
        run: () => telnyx.hangupCall({
          callControlId: aiTelnyxCallControlId,
          commandId: commandId(selectedCorrelationId, "hangup_ai_telnyx", aiTelnyxCallControlId)
        })
      });
    }
    const hangups = await Promise.allSettled(hangupActions.map((entry) => entry.run()));
    await closeRuntime(salesCallId);
    return [
      ...preHangup.map((result, index) => settledSummary(actions[index].action, result)),
      ...hangups.map((result, index) => settledSummary(hangupActions[index].action, result))
    ];
  }

  const orchestrator = {
    async beginCall({
      salesCallId,
      correlationId,
      conferenceName,
      operator,
      prospectNumber,
      xaiSipUri,
      correlationNonce,
      existingConference,
      existingProspect,
      existingAI,
      onCheckpoint
    }) {
      const selectedSalesCallId = requireSalesValue(salesCallId, "sales_call_id");
      const selectedCorrelationId = correlationId || selectedSalesCallId;
      const selectedOperator = normalizedOperator(operator);
      const selectedConferenceName = conferenceNameFor(selectedSalesCallId, conferenceName);
      requireSalesValue(selectedOperator.call_control_id, "operator_call_control_id");
      requireSalesValue(prospectNumber, "prospect_number");

      const operatorState = encodeSalesClientState({
        salesCallId: selectedSalesCallId,
        correlationId: selectedCorrelationId,
        role: "operator"
      });
      const prospectState = encodeSalesClientState({
        salesCallId: selectedSalesCallId,
        correlationId: selectedCorrelationId,
        role: "prospect"
      });
      const aiState = encodeSalesClientState({
        salesCallId: selectedSalesCallId,
        correlationId: selectedCorrelationId,
        role: "ai",
        nonce: requireSalesValue(correlationNonce, "correlation_nonce")
      });

      const checkpoint = async (patch) => {
        if (typeof onCheckpoint === "function") await onCheckpoint(patch);
      };
      let conference = existingConference?.conference_id
        ? {
            conference_id: existingConference.conference_id,
            conference_name:
              existingConference.conference_name || selectedConferenceName
          }
        : null;
      try {
        if (!conference) {
          conference = await telnyx.createConference({
            anchorCallControlId: selectedOperator.call_control_id,
            name: selectedConferenceName,
            clientState: operatorState,
            commandId: commandId(
              selectedCorrelationId,
              "create_conference",
              selectedConferenceName
            )
          });
          await checkpoint({
            conference_id: requireSalesValue(
              conference?.conference_id,
              "conference_id"
            ),
            conference_name:
              conference?.conference_name || selectedConferenceName,
            ...salesTelnyxCallPatch("operator", selectedOperator)
          });
        }
      } catch (cause) {
        const conferenceId = String(conference?.conference_id || "").trim();
        const teardown = conferenceId
          ? await Promise.allSettled([
              telnyx.endConference({
                conferenceId,
                commandId: commandId(
                  selectedCorrelationId,
                  "rollback_checkpoint_conference",
                  conferenceId
                )
              })
            ])
          : [];
        const providerPatch = summarizeSalesProviderError(cause);
        throw new SalesCallOrchestrationError("Unable to create the sales conference", {
          code: "sales_conference_create_failed",
          cause,
          teardown: teardown.map((result) => (
            settledSummary("end_conference", result)
          )),
          patch: {
            state: "failed",
            ai_state: "not_started",
            ...(conferenceId ? { conference_id: conferenceId } : {}),
            ...providerPatch,
            ended_at: nowIso(now)
          }
        });
      }

      const conferenceId = requireSalesValue(conference?.conference_id, "conference_id");
      const selectedXAISipUri = xaiSipUri || xai.buildSipUri();
      const dialAndCheckpoint = async (role, operation) => {
        const result = await operation();
        try {
          await checkpoint(salesTelnyxCallPatch(role, result.call));
        } catch (cause) {
          cause.salesProviderResult = result;
          throw cause;
        }
        return result;
      };
      const [prospectResult, aiResult] = await Promise.allSettled([
        existingProspect?.call_control_id
          ? Promise.resolve({ call: existingProspect, resumed: true })
          : dialAndCheckpoint("prospect", () => telnyx.dialProspect({
              to: prospectNumber,
              conferenceName:
                conference?.conference_name || selectedConferenceName,
              clientState: prospectState,
              commandId: commandId(
                selectedCorrelationId,
                "dial_prospect",
                prospectNumber
              )
            })),
        existingAI?.call_control_id
          ? Promise.resolve({ call: existingAI, resumed: true })
          : dialAndCheckpoint("ai", () => telnyx.dialXAISipStandby({
              sipUri: selectedXAISipUri,
              clientState: aiState,
              userToUser: aiState,
              commandId: commandId(
                selectedCorrelationId,
                "dial_ai_standby",
                selectedXAISipUri
              )
            }))
      ]);

      const prospect = fulfilledValue(prospectResult)
        || rejectedReason(prospectResult)?.salesProviderResult;
      const ai = fulfilledValue(aiResult)
        || rejectedReason(aiResult)?.salesProviderResult;
      const dialFailure = rejectedReason(prospectResult) || rejectedReason(aiResult);
      if (dialFailure) {
        const teardownActions = [];
        if (prospect?.call?.call_control_id) {
          teardownActions.push({
            action: "hangup_prospect",
            run: () => telnyx.hangupCall({
              callControlId: prospect.call.call_control_id,
              commandId: commandId(
                selectedCorrelationId,
                "rollback_hangup_prospect",
                prospect.call.call_control_id
              )
            })
          });
        }
        if (ai?.call?.call_control_id) {
          teardownActions.push({
            action: "hangup_ai",
            run: () => telnyx.hangupCall({
              callControlId: ai.call.call_control_id,
              commandId: commandId(
                selectedCorrelationId,
                "rollback_hangup_ai",
                ai.call.call_control_id
              )
            })
          });
        }
        teardownActions.push({
          action: "end_conference",
          run: () => telnyx.endConference({
            conferenceId,
            commandId: commandId(selectedCorrelationId, "rollback_end_conference", conferenceId)
          })
        });
        const teardownResults = await Promise.allSettled(teardownActions.map((entry) => entry.run()));
        const providerPatch = summarizeSalesProviderError(dialFailure);
        throw new SalesCallOrchestrationError("Unable to start both sales-call legs", {
          code: "sales_parallel_dial_failed",
          cause: dialFailure,
          teardown: teardownResults.map((result, index) => (
            settledSummary(teardownActions[index].action, result)
          )),
          patch: {
            state: "failed",
            ai_state: ai ? "tearing_down" : "dial_failed",
            conference_id: conferenceId,
            conference_name: conference?.conference_name || selectedConferenceName,
            ...salesTelnyxCallPatch("operator", selectedOperator),
            ...(prospect ? salesTelnyxCallPatch("prospect", prospect.call) : {}),
            ...(ai ? salesTelnyxCallPatch("ai", ai.call) : {}),
            ...providerPatch,
            ended_at: nowIso(now)
          }
        });
      }

      const patch = {
        state: "dialing_prospect",
        ai_state: "dialing_standby",
        conference_id: conferenceId,
        conference_name: conference?.conference_name || selectedConferenceName,
        ...salesTelnyxCallPatch("operator", selectedOperator),
        ...salesTelnyxCallPatch("prospect", prospect.call),
        ...salesTelnyxCallPatch("ai", ai.call),
        started_at: nowIso(now),
        metadata_json: {
          correlation_id: selectedCorrelationId,
          source: "outbound_sales"
        }
      };
      log("info", "sales_call_started", {
        sales_call_id: selectedSalesCallId,
        correlation_id: selectedCorrelationId,
        conference_id: conferenceId
      });
      return {
        patch,
        provider: {
          conference,
          prospect,
          ai
        }
      };
    },

    async prepareAIStandby({
      salesCallId,
      correlationId,
      xaiCallId,
      realtimeSession,
      aiTelnyxCallControlId,
      onEvent,
      onError,
      onClose
    }) {
      const selectedSalesCallId = requireSalesValue(salesCallId, "sales_call_id");
      const selectedCorrelationId = correlationId || selectedSalesCallId;
      const selectedXAICallId = requireSalesValue(xaiCallId, "xai_call_id");
      try {
        const accepted = await xai.acceptIncomingCall({
          callId: selectedXAICallId,
          session: realtimeSession,
          clientRequestId: commandId(
            selectedCorrelationId,
            "accept_xai_standby",
            selectedXAICallId
          )
        });
        const controller = await xai.connectMonitor({
          callId: selectedXAICallId,
          correlationId: selectedCorrelationId,
          onEvent,
          onError,
          onClose
        });
        await realtimeRegistry.set(selectedSalesCallId, controller);
        log("info", "sales_ai_standby_ready", {
          sales_call_id: selectedSalesCallId,
          correlation_id: selectedCorrelationId,
          xai_call_id: selectedXAICallId
        });
        return {
          patch: {
            xai_call_id: selectedXAICallId,
            ai_state: "ready"
          },
          provider: {
            accepted,
            controller
          }
        };
      } catch (cause) {
        const teardown = await teardownAIOnly({
          salesCallId: selectedSalesCallId,
          correlationId: selectedCorrelationId,
          aiTelnyxCallControlId,
          xaiCallId: selectedXAICallId,
          leaveConference: false
        });
        throw new SalesCallOrchestrationError("Unable to prepare the AI standby leg", {
          code: "sales_ai_standby_failed",
          cause,
          teardown,
          patch: {
            xai_call_id: selectedXAICallId,
            ai_state: "failed",
            ...summarizeSalesProviderError(cause)
          }
        });
      }
    },

    async startDemo({
      salesCallId,
      correlationId,
      conferenceId,
      aiTelnyxCallControlId,
      xaiCallId,
      businessName,
      joinTimeoutMs = 5000,
      beforeGreeting,
      onGreetingAcknowledged
    }) {
      const selectedSalesCallId = requireSalesValue(salesCallId, "sales_call_id");
      const selectedCorrelationId = correlationId || selectedSalesCallId;
      const selectedConferenceId = requireSalesValue(conferenceId, "conference_id");
      const selectedAIControlId = requireSalesValue(
        aiTelnyxCallControlId,
        "ai_telnyx_call_control_id"
      );
      const controller = await realtimeRegistry.get(selectedSalesCallId);
      if (!controller?.isOpen) {
        throw new SalesCallOrchestrationError("AI standby is not ready", {
          code: "sales_ai_standby_not_ready",
          patch: { ai_state: "not_ready" }
        });
      }

      try {
        const joined = await telnyx.joinConference({
          conferenceId: selectedConferenceId,
          callControlId: selectedAIControlId,
          commandId: commandId(selectedCorrelationId, "join_ai_conference", selectedAIControlId)
        });
        const participant = typeof participantJoinWaiter === "function"
          ? await participantJoinWaiter({
              salesCallId: selectedSalesCallId,
              correlationId: selectedCorrelationId,
              conferenceId: selectedConferenceId,
              callControlId: selectedAIControlId,
              timeoutMs: joinTimeoutMs
            })
          : await telnyx.waitForConferenceParticipant({
              conferenceId: selectedConferenceId,
              callControlId: selectedAIControlId,
            timeoutMs: joinTimeoutMs
          });
        if (typeof beforeGreeting === "function") await beforeGreeting();
        const greeting = await controller.startDemo({ businessName });
        if (typeof onGreetingAcknowledged === "function") {
          await onGreetingAcknowledged(greeting);
        }
        log("info", "sales_ai_demo_started", {
          sales_call_id: selectedSalesCallId,
          correlation_id: selectedCorrelationId,
          conference_id: selectedConferenceId,
          xai_call_id: xaiCallId || controller.callId
        });
        return {
          patch: {
            state: "ai_live",
            ai_state: "live",
            demo_started_at: nowIso(now)
          },
          provider: {
            joined,
            participant,
            greeting
          }
        };
      } catch (cause) {
        const teardown = await teardownAIOnly({
          salesCallId: selectedSalesCallId,
          correlationId: selectedCorrelationId,
          conferenceId: selectedConferenceId,
          aiTelnyxCallControlId: selectedAIControlId,
          xaiCallId: xaiCallId || controller.callId
        });
        throw new SalesCallOrchestrationError("Unable to join or start the AI demo", {
          code: "sales_ai_demo_start_failed",
          cause,
          teardown,
          patch: {
            ai_state: "failed",
            ...summarizeSalesProviderError(cause)
          }
        });
      }
    },

    async pauseAI({ salesCallId }) {
      const selectedSalesCallId = requireSalesValue(salesCallId, "sales_call_id");
      const controller = await realtimeRegistry.get(selectedSalesCallId);
      if (!controller?.isOpen) {
        throw new SalesCallOrchestrationError("AI demo is not connected", {
          code: "sales_ai_not_connected",
          patch: { ai_state: "disconnected" }
        });
      }
      const provider = controller.pause();
      return {
        patch: { ai_state: "paused" },
        provider
      };
    },

    async endDemo({
      salesCallId,
      correlationId,
      conferenceId,
      aiTelnyxCallControlId,
      xaiCallId
    }) {
      const selectedSalesCallId = requireSalesValue(salesCallId, "sales_call_id");
      const teardown = await teardownAIOnly({
        salesCallId: selectedSalesCallId,
        correlationId: correlationId || selectedSalesCallId,
        conferenceId,
        aiTelnyxCallControlId,
        xaiCallId
      });
      const requiredActions = new Set([
        ...(xaiCallId ? ["hangup_xai"] : []),
        ...(aiTelnyxCallControlId ? ["hangup_ai_telnyx"] : [])
      ]);
      const teardownComplete = teardown.every((entry) => (
        !requiredActions.has(entry.action) || entry.status === "fulfilled"
      ));
      return {
        patch: teardownComplete
          ? {
              state: "demo_ended",
              ai_state: "ended",
              demo_ended_at: nowIso(now)
            }
          : {
              state: "ending_demo",
              ai_state: "tearing_down"
            },
        teardown,
        teardown_complete: teardownComplete
      };
    },

    async endCall({
      salesCallId,
      correlationId,
      conferenceId,
      operatorCallControlId,
      prospectCallControlId,
      aiTelnyxCallControlId,
      xaiCallId,
      outcome
    }) {
      const selectedSalesCallId = requireSalesValue(salesCallId, "sales_call_id");
      const selectedCorrelationId = correlationId || selectedSalesCallId;
      const controller = await realtimeRegistry.get(selectedSalesCallId);
      const actions = [];
      if (controller?.isOpen) {
        actions.push({ action: "pause_ai", run: () => controller.pause() });
      }
      if (xaiCallId) {
        actions.push({
          action: "hangup_xai",
          run: () => xai.hangupCall({
            callId: xaiCallId,
            clientRequestId: commandId(selectedCorrelationId, "end_call_xai", xaiCallId)
          })
        });
      }
      if (aiTelnyxCallControlId) {
        actions.push({
          action: "hangup_ai_telnyx",
          run: () => telnyx.hangupCall({
            callControlId: aiTelnyxCallControlId,
            commandId: commandId(
              selectedCorrelationId,
              "end_call_ai_telnyx",
              aiTelnyxCallControlId
            )
          })
        });
      }
      const settled = await Promise.allSettled(
        actions.map((entry) => entry.run())
      );
      let conferenceResult = null;
      if (conferenceId) {
        conferenceResult = await Promise.allSettled([telnyx.endConference({
          conferenceId,
          commandId: commandId(
            selectedCorrelationId,
            "end_call_conference",
            conferenceId
          )
        })]);
      }
      const mustHangupHumans =
        !conferenceId || conferenceResult?.[0]?.status === "rejected";
      const humanActions = [];
      if (mustHangupHumans) {
        for (const [role, callControlId] of [
          ["operator", operatorCallControlId],
          ["prospect", prospectCallControlId]
        ]) {
          if (!callControlId) continue;
          humanActions.push({
            action: `hangup_${role}`,
            run: () => telnyx.hangupCall({
              callControlId,
              commandId: commandId(
                selectedCorrelationId,
                `end_call_${role}`,
                callControlId
              )
            })
          });
        }
      }

      const humanSettled = await Promise.allSettled(
        humanActions.map((entry) => entry.run())
      );
      await closeRuntime(selectedSalesCallId);
      const teardown = [
        ...settled.map((result, index) => (
          settledSummary(actions[index].action, result)
        )),
        ...(conferenceResult
          ? [settledSummary("end_conference", conferenceResult[0])]
          : []),
        ...humanSettled.map((result, index) => (
          settledSummary(humanActions[index].action, result)
        ))
      ];
      const requiredActionNames = new Set([
        ...(xaiCallId ? ["hangup_xai"] : []),
        ...(aiTelnyxCallControlId ? ["hangup_ai_telnyx"] : []),
        ...(mustHangupHumans
          ? humanActions.map((entry) => entry.action)
          : ["end_conference"])
      ]);
      const failedActions = teardown.filter((entry) => (
        requiredActionNames.has(entry.action) && entry.status === "rejected"
      ));
      const teardownComplete = failedActions.length === 0;
      log(failedActions.length ? "warn" : "info", "sales_call_ended", {
        sales_call_id: selectedSalesCallId,
        correlation_id: selectedCorrelationId,
        failed_teardown_actions: failedActions.map((entry) => entry.action)
      });
      return {
        patch: {
          state: teardownComplete ? "closed" : "ending",
          ai_state: teardownComplete ? "ended" : "tearing_down",
          ...(outcome ? { outcome: String(outcome) } : {}),
          ...(teardownComplete ? { ended_at: nowIso(now) } : {}),
          ...(failedActions.length
            ? {
                provider_error_code: "teardown_partial_failure",
                provider_error_message: failedActions
                  .map((entry) => `${entry.action}: ${entry.error}`)
                  .join(" | ")
                  .slice(0, 1000)
              }
            : {})
        },
        teardown,
        teardown_complete: teardownComplete
      };
    },

    async teardownNoAnswer(input) {
      return orchestrator.endCall({
        ...input,
        outcome: input?.outcome || "no_answer"
      });
    }
  };
  return orchestrator;
}
