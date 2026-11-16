// Explicit business-field coverage; migration parity is verified by tests.
export const SALES_HISTORY_INVENTORY = Object.freeze({
  "sales_prospects": {
    "entityType": "company",
    "idColumn": "prospect_id",
    "fields": [
      "source_key",
      "external_ref",
      "business_name",
      "owner_first_name",
      "contact_name",
      "contact_email",
      "email_permission",
      "email_suppressed_at",
      "email_suppression_reason",
      "smartlead_lead_id",
      "smartlead_campaign_id",
      "smartlead_status",
      "last_email_event_at",
      "lead_delivery_email",
      "phone_e164",
      "numbers_json",
      "website_url",
      "business_category",
      "competitor_name",
      "timezone",
      "permission_granted",
      "permission_recorded_at",
      "suppressed",
      "suppression_reason",
      "suppressed_at",
      "do_not_call",
      "do_not_call_at",
      "status",
      "last_outcome",
      "last_outcome_at",
      "assigned_rep_user_id",
      "callback_at",
      "inbound_return",
      "dnc_reason",
      "removed_reason",
      "tenant_key",
      "default_contact_id",
      "callback_contact_id",
      "callback_number_id",
      "metadata_json.contactRole",
      "metadata_json.metro",
      "metadata_json.pitchFlags",
      "metadata_json.city",
      "metadata_json.region",
      "metadata_json.afterHoursClass",
      "metadata_json.postedHours",
      "metadata_json.callOpenerHook",
      "metadata_json.researchNotes"
    ]
  },
  "sales_prospect_contacts": {
    "entityType": "contact",
    "idColumn": "contact_id",
    "fields": [
      "first_name",
      "last_name",
      "email",
      "title",
      "decision_maker",
      "influencer",
      "notes",
      "archived_at"
    ]
  },
  "sales_prospect_contact_numbers": {
    "entityType": "number",
    "idColumn": "number_id",
    "fields": [
      "contact_id",
      "phone_e164",
      "type",
      "label",
      "position",
      "archived_at"
    ]
  },
  "sales_prospect_notes": {
    "entityType": "company_note",
    "idColumn": "sales_prospect_note_id",
    "fields": [
      "body",
      "sales_call_id"
    ]
  },
  "sales_call_sessions": {
    "entityType": "call",
    "idColumn": "sales_call_id",
    "fields": [
      "prospect_id",
      "admin_user_id",
      "state",
      "outcome",
      "outcome_notes",
      "live_notes",
      "callback_at",
      "dialed_number",
      "started_at",
      "connected_at",
      "demo_started_at",
      "demo_ended_at",
      "ended_at",
      "link_sent_at",
      "booked_at",
      "paid_at",
      "metadata_json.dispositions"
    ]
  },
  "sales_dnc_registry": {
    "entityType": "do_not_call",
    "idColumn": "identity_value",
    "fields": [
      "identity_type",
      "identity_value",
      "reason"
    ]
  },
  "sales_dialer_config": {
    "entityType": "settings",
    "idColumn": "id",
    "fields": [
      "phone_test_mode",
      "custom_signup_amount_enabled",
      "scripts_json.opener",
      "scripts_json.if_interested",
      "scripts_json.if_voicemail",
      "scripts_json.talk_discovery",
      "scripts_json.handoff",
      "scripts_json.objections",
      "scripts_json.no_time",
      "scripts_json.gatekeeper",
      "scripts_json.while_you_listen",
      "scripts_json.exit_line",
      "scripts_json.close",
      "scripts_json.close_decline"
    ]
  },
  "sales_operator_settings": {
    "entityType": "operator",
    "idColumn": "admin_user_id",
    "fields": [
      "display_name",
      "caller_id_number",
      "active"
    ]
  },
  "sales_setup_bookings": {
    "entityType": "booking",
    "idColumn": "booking_id",
    "fields": [
      "sales_call_id",
      "rep_user_id",
      "calendar_owner",
      "starts_at",
      "ends_at",
      "attendee_email",
      "status",
      "paid_at_booking"
    ]
  },
  "sales_checkout_sessions": {
    "entityType": "checkout",
    "idColumn": "checkout_id",
    "fields": [
      "sales_call_id",
      "rep_user_id",
      "channel",
      "recipient",
      "amount_cents",
      "status",
      "paid_at",
      "activation_status",
      "tenant_key",
      "is_test"
    ]
  },
  "sales_incoming_calls": {
    "entityType": "incoming_call",
    "idColumn": "incoming_id",
    "fields": [
      "phone_e164",
      "rep_user_id",
      "prospect_id",
      "sales_call_id",
      "state",
      "message"
    ]
  }
});
