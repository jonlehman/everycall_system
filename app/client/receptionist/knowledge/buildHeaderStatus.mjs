export const DEFAULT_KNOWLEDGE_BUILD_STEP_TOTAL = 7;

export function isKnowledgeBuildActive(build) {
  const status = String(build?.status || '').trim().toLowerCase();
  return status === 'queued' || status === 'running';
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export function resolveKnowledgeBuildHeaderStatus(build, { published = false } = {}) {
  const status = String(build?.status || '').trim().toLowerCase();
  const progress = build?.progress || null;

  if (isKnowledgeBuildActive(build)) {
    const step = positiveInteger(progress?.step, 1);
    const stepTotal = Math.max(
      step,
      positiveInteger(progress?.stepTotal, DEFAULT_KNOWLEDGE_BUILD_STEP_TOTAL)
    );
    const detail = [progress?.label, progress?.summary]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(': ');
    return {
      active: true,
      detail: detail || 'Build in progress',
      label: `Step ${step} of ${stepTotal}`,
      tone: 'warn'
    };
  }

  if (published) {
    return {
      active: false,
      detail: 'The latest build is live for calls.',
      label: 'Build completed and published',
      tone: 'ok'
    };
  }

  if (!build) {
    return {
      active: false,
      detail: 'Create a build to publish this source.',
      label: 'No build yet',
      tone: 'warn'
    };
  }

  if (status === 'ready_to_publish') {
    return {
      active: false,
      detail: 'The build is complete and waiting to be published.',
      label: 'Ready to publish',
      tone: 'warn'
    };
  }

  if (status === 'failed') {
    return {
      active: false,
      detail: 'The latest build did not complete.',
      label: 'Build failed',
      tone: 'bad'
    };
  }

  if (status === 'qa_blocked') {
    return {
      active: false,
      detail: 'The latest build needs review before it can be published.',
      label: 'Build needs review',
      tone: 'bad'
    };
  }

  if (status === 'published' || status === 'superseded') {
    return {
      active: false,
      detail: 'This build is complete, but it is not the build currently live for this source.',
      label: 'Previous build',
      tone: 'warn'
    };
  }

  return {
    active: false,
    detail: 'The latest build is not currently running or published.',
    label: 'Build not published',
    tone: 'warn'
  };
}
