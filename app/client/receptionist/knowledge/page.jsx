'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SalesReceptionistNumberHeaderAside from '../../_components/SalesReceptionistNumberHeaderAside';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';
import StepSection from '../../_components/StepSection';

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

function isInteractiveGuideTarget(target) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, button, a, label, [role="button"]'));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

function formatLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isBuildActive(build) {
  const status = String(build?.status || '').trim().toLowerCase();
  return status === 'queued' || status === 'running';
}

function buildBadgeTone(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'published' || normalized === 'ready_to_publish') return 'ok';
  if (normalized === 'failed' || normalized === 'qa_blocked') return 'bad';
  return 'warn';
}

function buildStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ready_to_publish') return 'Publishing Soon';
  if (normalized === 'qa_blocked') return 'Needs Review';
  return formatLabel(normalized || status) || 'Unknown';
}

function buildStatusTone(status, hasPendingDocumentChanges = false) {
  if (hasPendingDocumentChanges) return 'warn';
  return buildBadgeTone(status);
}

function isWebsiteBuildKind(buildKind) {
  const normalized = String(buildKind || '').trim().toLowerCase();
  return normalized === 'website_base' || normalized === 'legacy_combined';
}

function resolveWebsiteAncestorBuildId(builds, activeBuild) {
  const rows = Array.isArray(builds) ? builds : [];
  const startBuildId = String(activeBuild?.build_id || '').trim();
  if (!startBuildId) return '';
  const byBuildId = new Map(
    rows
      .map((build) => [String(build?.build_id || '').trim(), build])
      .filter(([buildId]) => Boolean(buildId))
  );
  let currentBuildId = startBuildId;
  const visited = new Set();
  while (currentBuildId && !visited.has(currentBuildId)) {
    visited.add(currentBuildId);
    const build = byBuildId.get(currentBuildId);
    if (!build) break;
    if (isWebsiteBuildKind(build.build_kind)) {
      return currentBuildId;
    }
    const nextBuildId = String(build?.base_build_id || '').trim();
    if (!nextBuildId) break;
    currentBuildId = nextBuildId;
  }
  return '';
}

function buildDocumentPendingState({ approvedDocuments = [], latestLiveBuild = null } = {}) {
  const appliedDocumentIds = new Set(
    Array.isArray(latestLiveBuild?.intake_metadata_json?.uploaded_document_ids)
      ? latestLiveBuild.intake_metadata_json.uploaded_document_ids.map((value) => String(value || '').trim()).filter(Boolean)
      : []
  );
  const approvedDocumentIds = new Set(
    approvedDocuments
      .map((document) => String(document?.uploaded_document_id || '').trim())
      .filter(Boolean)
  );
  const pendingApprovedDocuments = approvedDocuments.filter((document) => !appliedDocumentIds.has(String(document?.uploaded_document_id || '').trim()));
  const removedLiveDocumentIds = Array.from(appliedDocumentIds).filter((id) => !approvedDocumentIds.has(id));
  return {
    pendingApprovedDocuments,
    removedLiveDocumentIds,
    pendingCount: pendingApprovedDocuments.length + removedLiveDocumentIds.length,
    hasPendingChanges: pendingApprovedDocuments.length > 0 || removedLiveDocumentIds.length > 0
  };
}

function renderBuildProgress(build) {
  const progress = build?.progress || null;
  if (!progress) return 'No progress details yet.';
  return `${progress.label}: ${progress.summary}`;
}

function buildDisplayLabel(build, index) {
  const version = String(build?.version || '').trim();
  if (version) return version;
  return `Build ${index + 1}`;
}

function progressStageTone(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (normalized === 'active') return 'border-primary/20 bg-primary text-white';
  return 'border-slate-200 bg-white text-slate-500';
}

function BuildProgressMeter({ build, compact = false }) {
  const progress = build?.progress || null;
  if (!progress || typeof progress.percent !== 'number') return null;
  const details = Array.isArray(progress.details) ? progress.details.filter(Boolean) : [];
  const stages = Array.isArray(progress.stages) ? progress.stages : [];
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>{progress.label}</span>
        <span>{progress.percent}%{progress.step && progress.stepTotal ? ` • Step ${progress.step} of ${progress.stepTotal}` : ''}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-slate-900 transition-all"
          style={{ width: `${Math.max(4, progress.percent)}%` }}
        />
      </div>
      {stages.length ? (
        <div className={`mt-2 grid gap-1 ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4 xl:grid-cols-7'}`}>
          {stages.map((stage) => (
            <div
              key={`${build?.build_id || 'build'}-${stage.key}`}
              className={`rounded-md border px-2 py-1 text-[11px] font-medium ${progressStageTone(stage.status)}`}
            >
              {stage.label}
            </div>
          ))}
        </div>
      ) : null}
      {details.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {details.slice(0, compact ? 3 : 5).map((detail) => (
            <span key={`${build?.build_id || 'build'}-${detail}`} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
              {detail}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CollapseToggleButton({ expanded, onClick, expandedLabel, collapsedLabel }) {
  return (
    <button
      type="button"
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
      onClick={onClick}
      aria-label={expanded ? expandedLabel : collapsedLabel}
      aria-expanded={expanded}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        className={`h-5 w-5 transition-transform ${expanded ? 'rotate-180' : ''}`}
        aria-hidden="true"
      >
        <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function ensureSentence(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function buildRepresentativeAnswer(answerPacket) {
  const packet = answerPacket || {};
  const direct = Array.isArray(packet.direct_answer_points) ? packet.direct_answer_points.filter(Boolean) : [];
  const qualifiers = Array.isArray(packet.qualifiers) ? packet.qualifiers.filter(Boolean) : [];
  const limits = Array.isArray(packet.limits_or_exclusions) ? packet.limits_or_exclusions.filter(Boolean) : [];
  const nextSteps = Array.isArray(packet.next_step_options) ? packet.next_step_options.filter(Boolean) : [];
  const unsupported = Array.isArray(packet.unsupported_requested_items) ? packet.unsupported_requested_items.filter(Boolean) : [];
  const shouldLeadWithNextStep = !direct.length || unsupported.length > 0 || String(packet.runtime_mode || '').trim() !== 'answer';

  const parts = [];
  if (direct.length) {
    parts.push(direct.slice(0, 2).map(ensureSentence).join(' '));
  }
  if (qualifiers.length) {
    parts.push(`Key qualifiers: ${qualifiers.slice(0, 2).join('; ')}.`);
  }
  if (limits.length) {
    parts.push(`Limits or exclusions: ${limits.slice(0, 2).join('; ')}.`);
  }
  if (unsupported.length) {
    parts.push(`Confirmed details are not available for: ${unsupported.slice(0, 2).join('; ')}.`);
  }
  if (nextSteps.length && shouldLeadWithNextStep) {
    parts.push(`Likely next step: ${ensureSentence(nextSteps[0])}`);
  }
  return parts.join(' ').trim() || 'No representative answer is available for this preview yet.';
}

const guideByContext = {
  website: {
    step: '01',
    title: 'Website',
    body: 'Set the main website URL for the website base. Rebuilding the website refreshes crawled site content and keeps approved documents applied on top of it.',
    tip: 'Use the main public site, not a deep page, so the website rebuild can discover the right content.'
  },
  documentsMeta: {
    step: '01',
    title: 'Document Details',
    body: 'Name the document, choose its class, and pick the document source type before saving it.',
    tip: 'Use clear titles so your team can recognize each saved document later.'
  },
  documentsFile: {
    step: '01',
    title: 'Upload File',
    body: 'Use file upload for .txt source documents that should override or supplement website content.',
    tip: 'Use this for finalized plain-text reference documents that should become part of the next build.'
  },
  documentsPage: {
    step: '01',
    title: 'Single Web Page',
    body: 'Use a single web page document when one exact page should override or supplement the larger website build without crawling child pages.',
    tip: 'Paste the exact page URL you want to import. Only that page is fetched.'
  },
  websiteBuild: {
    step: '01',
    title: 'Rebuild Website',
    body: 'Rebuild Website refreshes the website base and publishes a new live knowledge base automatically when it is ready.',
    tip: 'Use this after major website changes or when the base site content needs a fresh crawl.'
  },
  documentApply: {
    step: '01',
    title: 'Apply Documents',
    body: 'Apply Documents reuses the current live website base and layers the approved documents on top without crawling the website again.',
    tip: 'Use this after saving a document or single-page source so the override can go live quickly.'
  },
  testQuestion: {
    step: '02',
    title: 'Test Customer Questions',
    body: 'Ask caller-style questions against the current knowledge base to check how the sales receptionist is likely to answer.',
    tip: 'Use the same wording real callers would use on the phone.'
  },
  likelyAnswer: {
    step: '02',
    title: 'Likely Answer',
    body: 'This preview shows an estimated answer based on the current live build. It helps you sanity-check the knowledge before sending live calls to it.',
    tip: 'If the answer looks wrong, update the sources, create a new build, and test again.'
  },
  salesReceptionistNumber: {
    step: '01',
    title: 'Sales Receptionist Number',
    body: 'This is the EveryCall phone number your AI sales receptionist answers live. Your business phone system should forward callers to this number when you want EveryCall to pick up the call.',
    tip: 'Keep this number as the forwarding destination in your phone system so callers land on the receptionist instead of voicemail or another queue.'
  }
};

const knowledgeGuideOverview = {
  title: 'What This Page Does',
  body: 'This page manages the website base and document overlays that make up the published knowledge base your sales receptionist uses during live calls.',
  detail: 'Before a build is published, the sales receptionist can answer only generic questions from the business description. If a caller asks for specific business details it does not know yet, it will apologize and offer to have someone call them back.'
};

export default function ReceptionistKnowledgePage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ message: 'Loading knowledge tools...', tone: 'warn' });
  const [savingDocument, setSavingDocument] = useState(false);
  const [readingDocumentFile, setReadingDocumentFile] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState('');
  const [buildBusyKind, setBuildBusyKind] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [activeGuideKey, setActiveGuideKey] = useState('website');
  const [websiteSectionExpanded, setWebsiteSectionExpanded] = useState(false);
  const [documentsSectionExpanded, setDocumentsSectionExpanded] = useState(false);
  const [expandedDocumentIds, setExpandedDocumentIds] = useState({});

  const [documentForm, setDocumentForm] = useState({
    title: '',
    documentClass: 'operational',
    sourceKind: 'file_upload',
    sourceLocator: '',
    bodyText: '',
    filename: '',
    mimeType: 'text/plain',
    fileBase64: ''
  });
  const [buildForm, setBuildForm] = useState({ websiteUrl: '' });
  const [previewQuery, setPreviewQuery] = useState('');
  const guidePanelRef = useRef(null);

  const [buildState, setBuildState] = useState({ activeBuild: null, builds: [], assignments: [] });
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [preview, setPreview] = useState(null);

  const loadWorkspace = async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setStatus({ message: 'Loading knowledge tools...', tone: 'warn' });
    }
    try {
      const [
        buildData,
        documentData
      ] = await Promise.all([
        fetchJson('/api/v1/knowledge/builds'),
        fetchJson('/api/v1/knowledge/uploaded-documents')
      ]);

      const builds = buildData?.builds || [];
      setBuildState({
        activeBuild: buildData?.activeBuild || null,
        builds,
        assignments: buildData?.assignments || []
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('everycall:knowledge-updated', {
          detail: {
            builds,
            activeBuild: buildData?.activeBuild || null
          }
        }));
      }
      setUploadedDocuments(Array.isArray(documentData?.documents) ? documentData.documents : []);
      setBuildForm((current) => ({
        websiteUrl: current.websiteUrl || buildData?.bootstrapWebsiteUrl || builds[0]?.website_root_url || ''
      }));
      if (!silent) {
        setStatus({ message: 'Knowledge tools loaded.', tone: 'ok' });
      }
    } catch {
      if (!silent) {
        setStatus({ message: 'Could not load the knowledge tools.', tone: 'bad' });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    if (!buildState.builds.some((build) => isBuildActive(build))) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      loadWorkspace({ silent: true });
    }, 15000);
    return () => window.clearInterval(intervalId);
  }, [buildState.builds]);

  const queueBuild = async (buildKind) => {
    const normalizedBuildKind = String(buildKind || '').trim().toLowerCase();
    const isWebsiteBuild = normalizedBuildKind === 'website_base';
    const approvedDocumentIds = approvedUploadedDocuments.map((document) => document.uploaded_document_id);
    if (!isWebsiteBuild && !canApplyDocuments) {
      setStatus({ message: 'Save a document or remove a live document before applying documents.', tone: 'bad' });
      return;
    }

    setBuildBusyKind(normalizedBuildKind);
    setStatus({ message: isWebsiteBuild ? 'Queueing website rebuild...' : 'Queueing document apply...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buildKind: normalizedBuildKind,
          baseBuildId: !isWebsiteBuild ? (buildState.activeBuild?.active_build_id || undefined) : undefined,
          websiteUrl: isWebsiteBuild ? (buildForm.websiteUrl.trim() || undefined) : undefined,
          uploadedDocumentIds: approvedDocumentIds
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || (isWebsiteBuild ? 'Website rebuild failed.' : 'Document apply failed.'), tone: 'bad' });
        return;
      }
      const buildId = data.build?.build_id || '';
      if (buildId) {
        void fetch(`/api/v1/knowledge/builds/${encodeURIComponent(buildId)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }).catch(() => {});
      }
      await loadWorkspace({ silent: true });
      const finalStatus = String(data.status || '').trim().toLowerCase();
      setStatus({
        message: `${isWebsiteBuild ? 'Website rebuild' : 'Document apply'} ${buildId || 'request'} ${finalStatus === 'running' ? 'is already running' : 'queued'} and will publish automatically when it is ready. This page will update automatically.`,
        tone: 'ok'
      });
    } catch {
      setStatus({ message: isWebsiteBuild ? 'Website rebuild failed.' : 'Document apply failed.', tone: 'bad' });
    } finally {
      setBuildBusyKind('');
    }
  };

  const archiveDocument = async (uploadedDocumentId, title) => {
    const normalizedId = String(uploadedDocumentId || '').trim();
    if (!normalizedId) return;
    const label = String(title || 'this document').trim() || 'this document';
    if (typeof window !== 'undefined' && !window.confirm(`Remove ${label} from future knowledge builds? It will stay live until you click Apply Documents.`)) {
      return;
    }

    setDeletingDocumentId(normalizedId);
    setStatus({ message: 'Removing document...', tone: 'warn' });
    try {
      const data = await fetchJson(`/api/v1/knowledge/uploaded-documents/${encodeURIComponent(normalizedId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not remove that document.', tone: 'bad' });
        return;
      }
      await loadWorkspace({ silent: true });
      setStatus({ message: 'Document removed from future builds. Apply documents to update the live knowledge base.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not remove that document.', tone: 'bad' });
    } finally {
      setDeletingDocumentId('');
    }
  };

  const saveUploadedDocument = async () => {
    const title = documentForm.title.trim();
    const sourceKind = String(documentForm.sourceKind || '').trim();
    const sourceLocator = documentForm.sourceLocator.trim();
    if (sourceKind === 'single_page_url' && !sourceLocator) {
      setStatus({ message: 'Add the exact web page URL you want to use as a document.', tone: 'bad' });
      return;
    }
    if (sourceKind !== 'single_page_url' && !title && !documentForm.filename) {
      setStatus({ message: 'Uploaded documents need a title or filename.', tone: 'bad' });
      return;
    }
    if (sourceKind !== 'single_page_url' && !documentForm.fileBase64) {
      setStatus({ message: 'Choose a file to upload.', tone: 'bad' });
      return;
    }

    setSavingDocument(true);
    setStatus({ message: sourceKind === 'single_page_url' ? 'Saving web page document...' : 'Saving uploaded document...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/uploaded-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: {
            title: title || undefined,
            documentClass: documentForm.documentClass,
            sourceKind,
            sourceLocator: sourceLocator || undefined,
            filename: documentForm.filename || undefined,
            mimeType: documentForm.mimeType || undefined,
            fileBase64: documentForm.fileBase64 || undefined
          }
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not save uploaded document.', tone: 'bad' });
        return;
      }
      setDocumentForm({
        title: '',
        documentClass: 'operational',
        sourceKind: 'file_upload',
        sourceLocator: '',
        bodyText: '',
        filename: '',
        mimeType: 'text/plain',
        fileBase64: ''
      });
      await loadWorkspace({ silent: true });
      setStatus({ message: sourceKind === 'single_page_url' ? 'Web page document saved. Apply documents to make it live.' : 'Uploaded document saved. Apply documents to make it live.', tone: 'ok' });
    } catch {
      setStatus({ message: sourceKind === 'single_page_url' ? 'Could not save that web page document.' : 'Could not save uploaded document.', tone: 'bad' });
    } finally {
      setSavingDocument(false);
    }
  };

  const handleDocumentFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setDocumentForm((current) => ({
        ...current,
        sourceKind: 'file_upload',
        sourceLocator: '',
        filename: '',
        mimeType: 'text/plain',
        fileBase64: ''
      }));
      return;
    }

    const lowerName = String(file.name || '').toLowerCase();
    if (!lowerName.endsWith('.txt')) {
      setStatus({ message: 'Only .txt files can be uploaded here right now.', tone: 'bad' });
      event.target.value = '';
      return;
    }

    setReadingDocumentFile(true);
    try {
      const fileBase64 = await fileToBase64(file);
      setDocumentForm((current) => ({
        ...current,
        sourceKind: 'file_upload',
        sourceLocator: '',
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileBase64
      }));
      setStatus({ message: `${file.name} attached. Save the document to include it in the next build.`, tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not read that file. Try a different document.', tone: 'bad' });
    } finally {
      setReadingDocumentFile(false);
      event.target.value = '';
    }
  };

  const runRuntimePreview = async () => {
    setPreviewBusy(true);
    setPreview(null);
    setStatus({ message: 'Generating answer estimate...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/runtime-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: previewQuery.trim()
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not generate an answer estimate.', tone: 'bad' });
        return;
      }
      setPreview(data);
      setStatus({ message: 'Answer estimate ready.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not generate an answer estimate.', tone: 'bad' });
    } finally {
      setPreviewBusy(false);
    }
  };

  const latestBuild = buildState.builds[0] || null;
  const approvedUploadedDocuments = uploadedDocuments.filter((document) => String(document?.status || '').trim() === 'approved');
  const activeBuildId = String(buildState.activeBuild?.active_build_id || '').trim();
  const latestLiveBuild = buildState.builds.find((build) => String(build?.build_id || '').trim() === activeBuildId) || latestBuild;
  const latestWebsiteBuild = buildState.builds.find((build) => {
    return isWebsiteBuildKind(build?.build_kind);
  }) || null;
  const latestDocumentBuild = buildState.builds.find((build) => String(build?.build_kind || '').trim().toLowerCase() === 'document_overlay') || null;
  const documentPendingState = buildDocumentPendingState({ approvedDocuments: approvedUploadedDocuments, latestLiveBuild });
  const hasPendingDocumentChanges = documentPendingState.hasPendingChanges;
  const canApplyDocuments = approvedUploadedDocuments.length > 0 || documentPendingState.removedLiveDocumentIds.length > 0;
  const latestLiveBuildKind = String(latestLiveBuild?.build_kind || '').trim().toLowerCase();
  const latestWebsiteBuildId = String(latestWebsiteBuild?.build_id || '').trim();
  const latestDocumentBuildId = String(latestDocumentBuild?.build_id || '').trim();
  const liveWebsiteBuildId = resolveWebsiteAncestorBuildId(buildState.builds, latestLiveBuild);
  const websitePublished = Boolean(latestWebsiteBuildId) && latestWebsiteBuildId === liveWebsiteBuildId;
  const documentsPublished = latestLiveBuildKind === 'document_overlay' && Boolean(latestDocumentBuildId) && latestDocumentBuildId === activeBuildId;
  const websiteBuildStatusLabel = websitePublished ? 'Published' : buildStatusLabel(latestWebsiteBuild?.status);
  const websiteBuildStatusTone = websitePublished ? 'ok' : buildBadgeTone(latestWebsiteBuild?.status);
  const showWebsiteBuildProgress = latestWebsiteBuild && !websitePublished;
  const websiteBuildSummary = websitePublished
    ? 'This website crawl is part of the current live knowledge base.'
    : renderBuildProgress(latestWebsiteBuild);
  const previewAnswerPacket = preview?.answerPacket || null;
  const previewAnswer = preview?.spokenAnswerEstimate || buildRepresentativeAnswer(previewAnswerPacket);
  const previewAnswerDisplay = previewBusy
    ? 'Generating answer estimate...'
    : (preview
        ? previewAnswer
        : 'Your answer preview will appear here after you test a customer question.');
  const latestBuildStatus = String(latestLiveBuild?.status || '').trim().toLowerCase();
  const statusChip = buildState.builds.some((build) => isBuildActive(build))
    ? { tone: 'warn', label: 'Build In Progress' }
    : hasPendingDocumentChanges
      ? { tone: 'warn', label: 'Documents Pending' }
    : latestBuildStatus === 'published'
      ? { tone: 'ok', label: 'Knowledge Base Active' }
      : latestBuildStatus === 'ready_to_publish'
        ? { tone: 'warn', label: 'Publishing Soon' }
        : { tone: 'warn', label: 'Create Knowledge Base' };
  const activeGuide = guideByContext[activeGuideKey] || guideByContext.website;
  const activeStep = activeGuide.step || '01';
  const activeCardClassName = 'ring-2 ring-[#2563EB]/20 shadow-[0_0_0_1px_rgba(37,99,235,0.05)]';
  const openSalesReceptionistNumberGuide = () => {
    setActiveGuideKey('salesReceptionistNumber');
    guidePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const toggleWebsiteSectionExpanded = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveGuideKey('website');
    setWebsiteSectionExpanded((current) => !current);
  };
  const toggleDocumentsSectionExpanded = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveGuideKey('documentsMeta');
    setDocumentsSectionExpanded((current) => !current);
  };
  const toggleDocumentExpanded = (event, uploadedDocumentId) => {
    event.preventDefault();
    event.stopPropagation();
    const normalizedId = String(uploadedDocumentId || '').trim();
    if (!normalizedId) return;
    setActiveGuideKey('documentsMeta');
    setExpandedDocumentIds((current) => ({
      ...current,
      [normalizedId]: !current[normalizedId]
    }));
  };

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Knowledge"
      subtitle="Manage website and document sources, create a live build, and test customer questions."
      status={status}
      statusChip={statusChip}
      headerAside={<SalesReceptionistNumberHeaderAside onHelpClick={openSalesReceptionistNumberGuide} />}
    >
      <div className="mt-[36px] grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="grid min-w-0 gap-3">
          <div onClick={(event) => {
            if (isInteractiveGuideTarget(event.target)) return;
            setActiveGuideKey('website');
          }}>
            <StepSection
              step="01"
              title="Knowledge Sources"
              description="Manage the website base and document overlays that make up your live knowledge base."
              contentClassName={`border-0 bg-transparent p-0 ${activeStep === '01' ? activeCardClassName : ''}`}
            >
              <div className="space-y-4">
                <div
                  className="rounded-lg border border-[#E2E8F0] bg-[#eff4ff] p-6 shadow-sm"
                  onClick={() => setActiveGuideKey('website')}
                  onFocusCapture={() => setActiveGuideKey('website')}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-['Space_Grotesk'] text-xl font-bold text-[#1E293B]">Website</h4>
                        {websitePublished ? (
                          <span className="badge ok">Published</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">Crawl the main website and refresh the base knowledge layer.</p>
                    </div>
                    <CollapseToggleButton
                      expanded={websiteSectionExpanded}
                      onClick={toggleWebsiteSectionExpanded}
                      expandedLabel="Collapse website section"
                      collapsedLabel="Expand website section"
                    />
                  </div>
                  {websiteSectionExpanded ? (
                    <>
                      <label className="sr-only">Website URL</label>
                      <input
                        className="mt-4 w-full rounded border-[#E2E8F0] bg-white p-3 text-sm text-slate-900 focus:border-[#2563EB] focus:ring-[#2563EB]"
                        value={buildForm.websiteUrl}
                        onChange={(event) => setBuildForm({ websiteUrl: event.target.value })}
                        onFocus={() => setActiveGuideKey('website')}
                        placeholder="https://example.com"
                      />
                      {!latestBuild && buildForm.websiteUrl ? (
                        <div className="mt-2 text-xs text-slate-500">
                          Pre-filled from tenant setup. You can change it before creating the first build.
                        </div>
                      ) : null}
                      <div className="mt-4 flex flex-wrap items-center gap-3" onClick={() => setActiveGuideKey('websiteBuild')} onFocusCapture={() => setActiveGuideKey('websiteBuild')}>
                        <Button
                          className="h-auto rounded px-6 py-3 text-xs font-bold uppercase tracking-[0.18em]"
                          onClick={() => queueBuild('website_base')}
                          disabled={buildBusyKind === 'website_base'}
                        >
                          {buildBusyKind === 'website_base' ? 'Queueing...' : 'Rebuild Website'}
                        </Button>
                      </div>
                      {latestWebsiteBuild ? (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-900">Latest Website Build</div>
                              <div className="mt-1 text-sm text-slate-600">{buildDisplayLabel(latestWebsiteBuild, 0)}</div>
                            </div>
                            <span className={`badge ${websiteBuildStatusTone}`}>{websiteBuildStatusLabel}</span>
                          </div>
                          <div className="mt-2 text-sm text-slate-600">{websiteBuildSummary}</div>
                          {showWebsiteBuildProgress ? (
                            <BuildProgressMeter build={latestWebsiteBuild} compact />
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>

                <div
                  className="space-y-6 rounded-lg border border-[#E2E8F0] bg-[#eff4ff] p-6 shadow-sm"
                  onClick={() => setActiveGuideKey('documentsMeta')}
                  onFocusCapture={() => setActiveGuideKey('documentsMeta')}
                >
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-['Space_Grotesk'] text-xl font-bold text-[#1E293B]">Documents</h4>
                        {documentsPublished ? (
                          <span className="badge ok">Published</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        Uploaded documents and single web pages override any conflicting information from the website.
                      </p>
                    </div>
                    <CollapseToggleButton
                      expanded={documentsSectionExpanded}
                      onClick={toggleDocumentsSectionExpanded}
                      expandedLabel="Collapse documents section"
                      collapsedLabel="Expand documents section"
                    />
                  </div>

                  {documentsSectionExpanded ? (
                    <>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3" onClick={() => setActiveGuideKey('documentsMeta')} onFocusCapture={() => setActiveGuideKey('documentsMeta')}>
                        <div>
                          <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Document Title</label>
                          <input
                            className="w-full rounded border-[#E2E8F0] bg-white p-3 text-sm text-slate-900 focus:border-[#2563EB] focus:ring-[#2563EB]"
                            value={documentForm.title}
                            onChange={(event) => setDocumentForm((current) => ({ ...current, title: event.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Document Class</label>
                          <select
                            className="w-full rounded border-[#E2E8F0] bg-white p-3 text-sm text-slate-900 focus:border-[#2563EB] focus:ring-[#2563EB]"
                            value={documentForm.documentClass}
                            onChange={(event) => setDocumentForm((current) => ({ ...current, documentClass: event.target.value }))}
                          >
                            <option value="operational">Operational</option>
                            <option value="policy">Policy</option>
                            <option value="reference">Reference</option>
                            <option value="marketing">Marketing</option>
                            <option value="unclassified">Unclassified</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Source Type</label>
                          <select
                            className="w-full rounded border-[#E2E8F0] bg-white p-3 text-sm text-slate-900 focus:border-[#2563EB] focus:ring-[#2563EB]"
                            value={documentForm.sourceKind}
                            onChange={(event) => setDocumentForm((current) => ({
                              ...current,
                              sourceKind: event.target.value,
                              sourceLocator: event.target.value === 'single_page_url' ? current.sourceLocator : '',
                              filename: event.target.value === 'file_upload' ? current.filename : '',
                              mimeType: event.target.value === 'file_upload' ? current.mimeType : 'text/plain',
                              fileBase64: event.target.value === 'file_upload' ? current.fileBase64 : ''
                            }))}
                          >
                            <option value="file_upload">File Upload</option>
                            <option value="single_page_url">Single Web Page</option>
                          </select>
                        </div>
                      </div>

                      {documentForm.sourceKind === 'single_page_url' ? (
                        <div className="space-y-3 pt-4" onClick={() => setActiveGuideKey('documentsPage')} onFocusCapture={() => setActiveGuideKey('documentsPage')}>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Web Page URL</div>
                          <input
                            className="w-full rounded border-[#E2E8F0] bg-white p-3 text-sm text-slate-900 focus:border-[#2563EB] focus:ring-[#2563EB]"
                            value={documentForm.sourceLocator}
                            onChange={(event) => setDocumentForm((current) => ({ ...current, sourceLocator: event.target.value }))}
                            placeholder="https://example.com/specific-page"
                          />
                          <p className="mt-2 text-[10px] italic text-slate-500">
                            Only this exact page is imported. Child pages are not crawled.
                          </p>
                        </div>
                      ) : (
                        <div
                          className="space-y-3 pt-4"
                          onClick={() => setActiveGuideKey('documentsFile')}
                          onFocusCapture={() => setActiveGuideKey('documentsFile')}
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Upload File</div>
                          <div className="flex w-full items-center overflow-hidden rounded border border-[#E2E8F0] bg-white">
                            <label className="cursor-pointer border-r border-[#E2E8F0] bg-slate-100 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200">
                              Browse...
                              <input
                                className="hidden"
                                type="file"
                                accept=".txt,text/plain"
                                onChange={handleDocumentFileChange}
                                disabled={readingDocumentFile || savingDocument}
                              />
                            </label>
                            <span className="px-4 text-xs text-slate-500">
                              {documentForm.filename || 'No file selected.'}
                            </span>
                          </div>
                          <p className="mt-2 text-[10px] italic text-slate-500">
                            Upload a .txt file.
                          </p>
                        </div>
                      )}

                      <div onClick={() => setActiveGuideKey('documentsMeta')} onFocusCapture={() => setActiveGuideKey('documentsMeta')}>
                        <Button
                          variant="outline"
                          className="border-[#2563EB] bg-transparent px-6 py-3 text-xs font-bold uppercase tracking-widest text-[#2563EB] shadow-sm hover:bg-blue-50"
                          onClick={saveUploadedDocument}
                          disabled={savingDocument || readingDocumentFile}
                        >
                          {savingDocument ? 'Saving...' : (readingDocumentFile ? 'Reading File...' : 'Save Document')}
                        </Button>

                        <div className="mt-4">
                          <div className="text-sm font-semibold text-slate-900">Documents</div>
                        </div>

                        <div className="mt-3 grid gap-2">
                          {uploadedDocuments.length ? uploadedDocuments.map((document) => (
                            <div key={document.uploaded_document_id} className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="font-semibold text-slate-900">{document.title}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`badge ${document.status === 'approved' ? 'ok' : 'warn'}`}>{document.status}</span>
                                  <button
                                    type="button"
                                    className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    onClick={() => archiveDocument(document.uploaded_document_id, document.title)}
                                    disabled={Boolean(deletingDocumentId) || buildBusyKind === 'document_overlay'}
                                  >
                                    {deletingDocumentId === document.uploaded_document_id ? 'Removing...' : 'Delete'}
                                  </button>
                                  <CollapseToggleButton
                                    expanded={Boolean(expandedDocumentIds[String(document.uploaded_document_id || '').trim()])}
                                    onClick={(event) => toggleDocumentExpanded(event, document.uploaded_document_id)}
                                    expandedLabel="Collapse document details"
                                    collapsedLabel="Expand document details"
                                  />
                                </div>
                              </div>
                              {expandedDocumentIds[String(document.uploaded_document_id || '').trim()] ? (
                                <>
                                  <div className="mt-2 text-sm text-slate-600">
                                    {formatLabel(document.document_class)} · {formatLabel(document.source_authority)}
                                  </div>
                                  {document.source_kind ? (
                                    <div className="mt-1 text-xs text-slate-500">Source: {formatLabel(document.source_kind)}</div>
                                  ) : null}
                                  {document.filename ? (
                                    <div className="mt-1 text-xs text-slate-500">File: {document.filename}</div>
                                  ) : null}
                                  {!document.filename && document.source_locator ? (
                                    <div className="mt-1 break-all text-xs text-slate-500">Page: {document.source_locator}</div>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          )) : (
                            <p className="mt-4 text-[10px] text-slate-500">No uploaded documents yet.</p>
                          )}
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3" onClick={() => setActiveGuideKey('documentApply')} onFocusCapture={() => setActiveGuideKey('documentApply')}>
                          {hasPendingDocumentChanges ? (
                            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.16)]" aria-hidden="true" />
                          ) : null}
                          <Button
                            className="h-auto rounded px-6 py-3 text-xs font-bold uppercase tracking-[0.18em]"
                            onClick={() => queueBuild('document_overlay')}
                            disabled={buildBusyKind === 'document_overlay' || !canApplyDocuments}
                          >
                            {buildBusyKind === 'document_overlay' ? 'Queueing...' : 'Apply Documents'}
                          </Button>
                          {hasPendingDocumentChanges ? (
                            <span className="text-xs font-medium text-amber-700">
                              {documentPendingState.pendingCount} pending
                            </span>
                          ) : null}
                          {latestDocumentBuild ? (
                            <span className={`badge ${buildBadgeTone(latestDocumentBuild.status)}`}>{buildStatusLabel(latestDocumentBuild.status)}</span>
                          ) : (
                            <span className="text-xs text-slate-500">No document apply yet.</span>
                          )}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>

                {buildState.builds.some((build) => isBuildActive(build)) ? (
                  <div className="text-sm text-slate-600">
                    Build status auto-refreshes every 15 seconds while work is active.
                  </div>
                ) : null}
              </div>
            </StepSection>
          </div>

          <div onClick={(event) => {
            if (isInteractiveGuideTarget(event.target)) return;
            setActiveGuideKey('testQuestion');
          }}>
            <StepSection
              className="mt-24"
              step="02"
              title="Test Customer Questions"
              description="Ask a caller-style question to see an approximate answer based on the current knowledge base."
              contentClassName={activeStep === '02' ? activeCardClassName : ''}
            >
              <label className="mt-2.5">Test Question</label>
              <input
                value={previewQuery}
                onChange={(event) => setPreviewQuery(event.target.value)}
                onFocus={() => setActiveGuideKey('testQuestion')}
                placeholder="Do you handle after-hours emergencies?"
              />
              <div className="mt-3">
                <Button
                  onClick={runRuntimePreview}
                  onFocus={() => setActiveGuideKey('testQuestion')}
                  disabled={previewBusy || !previewQuery.trim()}
                >
                  {previewBusy ? 'Testing...' : 'Test Answer'}
                </Button>
              </div>
              <div className="mt-3 grid gap-3">
                <div
                  className="flex h-48 flex-col rounded-lg border border-slate-200 bg-white p-4"
                  onClick={() => setActiveGuideKey('likelyAnswer')}
                  onFocusCapture={() => setActiveGuideKey('likelyAnswer')}
                >
                  <div className="text-sm font-semibold text-slate-900">Likely Answer</div>
                  <div className={`mt-2 flex-1 overflow-y-auto pr-2 text-sm leading-6 ${preview ? 'text-slate-700' : 'text-slate-500'}`}>
                    {previewAnswerDisplay}
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">Preview only. Live answers will vary based on call context.</div>
                </div>
              </div>
            </StepSection>
          </div>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Next Steps</h2>
            <p className="m-0 mt-2 text-sm text-slate-600">
              After your latest build finishes and your test questions look right, make sure the right users are set to receive call alerts on the Team page.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/client/team" className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_rgba(0,74,198,0.16)]">
                Open Team
              </Link>
              <Link href="/client/calls" className="inline-flex rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm">
                Open Calls
              </Link>
            </div>
          </section>
        </div>

        <div ref={guidePanelRef}>
          <GuidePanel
            title="Knowledge Guide"
            eyebrow=""
            icon="architecture"
            className="self-start xl:sticky xl:top-32 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto"
          >
            <div className="rounded-2xl border border-[#d6e4ff] bg-[#f5f8ff] p-3">
              <div className="font-semibold text-slate-900">{knowledgeGuideOverview.title}</div>
              <div className="mt-1 text-sm text-slate-600">{knowledgeGuideOverview.body}</div>
              <div className="mt-2 text-sm text-slate-600">{knowledgeGuideOverview.detail}</div>
            </div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-slate-500">{`Step ${activeStep}`}</div>
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <div className="font-semibold text-slate-900">{activeGuide.title}</div>
              <div className="mt-1 text-sm text-slate-600">{activeGuide.body}</div>
            </div>
            <div className="rounded-2xl border border-[#d6e4ff] bg-[#f5f8ff] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#004ac6]">Tip</div>
              <div className="mt-2 text-sm italic text-slate-600">{activeGuide.tip}</div>
            </div>
          </GuidePanel>
        </div>
      </div>
    </SectionPage>
  );
}
