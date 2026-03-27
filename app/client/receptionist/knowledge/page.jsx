'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SalesReceptionistNumberBadge from '../../_components/SalesReceptionistNumberBadge';
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
    body: 'Set the main website URL the next build should crawl. That site content becomes part of the knowledge set your sales receptionist uses live.',
    tip: 'Use the main public site, not a deep page, so the build can discover the right content.'
  },
  documentsMeta: {
    step: '01',
    title: 'Document Details',
    body: 'Name the document and choose its class before saving it. Approved uploaded documents are bundled into future builds alongside website content.',
    tip: 'Use clear titles so your team can recognize each saved document later.'
  },
  documentsFile: {
    step: '01',
    title: 'Upload File',
    body: 'Use file upload when the source already exists as a PDF, Word document, or text file that should feed the next build.',
    tip: 'Use this for formal documents such as pricing sheets, policies, and reference material.'
  },
  documentsText: {
    step: '01',
    title: 'Document Text',
    body: 'Paste short source text directly when you do not need to upload a file. This is useful for rules, scripts, and internal notes.',
    tip: 'Paste only the exact text you want the receptionist to prioritize.'
  },
  createBuild: {
    step: '01',
    title: 'Create Build',
    body: 'Create Build packages the current website URL and approved uploaded documents into a single knowledge version.',
    tip: 'After changing the website or documents, create a new build so those updates can be published.'
  },
  buildHistory: {
    step: '02',
    title: 'Build History',
    body: 'Each build is a saved knowledge version. Publish the version you want the sales receptionist to use for live caller questions.',
    tip: 'Only a published build can answer customer questions during live calls.'
  },
  testQuestion: {
    step: '03',
    title: 'Test Customer Questions',
    body: 'Ask caller-style questions against the current published build to check how the sales receptionist is likely to answer.',
    tip: 'Use the same wording real callers would use on the phone.'
  },
  likelyAnswer: {
    step: '03',
    title: 'Likely Answer',
    body: 'This preview shows an estimated answer based on the current published build. It helps you sanity-check the knowledge before sending live calls to it.',
    tip: 'If the answer looks wrong, update the sources or publish a newer build and test again.'
  }
};

export default function ReceptionistKnowledgePage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ message: 'Loading knowledge tools...', tone: 'warn' });
  const [savingDocument, setSavingDocument] = useState(false);
  const [readingDocumentFile, setReadingDocumentFile] = useState(false);
  const [buildBusy, setBuildBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [publishingBuildId, setPublishingBuildId] = useState('');
  const [activeGuideKey, setActiveGuideKey] = useState('website');

  const [documentForm, setDocumentForm] = useState({
    title: '',
    documentClass: 'operational',
    bodyText: '',
    filename: '',
    mimeType: 'text/plain',
    fileBase64: ''
  });
  const [buildForm, setBuildForm] = useState({ websiteUrl: '' });
  const [previewQuery, setPreviewQuery] = useState('');

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

  const createBuild = async () => {
    setBuildBusy(true);
    setStatus({ message: 'Queueing build...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteUrl: buildForm.websiteUrl.trim() || undefined,
          uploadedDocumentIds: approvedUploadedDocuments.map((document) => document.uploaded_document_id)
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Build failed.', tone: 'bad' });
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
        message: `Build ${buildId || 'created'} ${finalStatus === 'running' ? 'is already running' : 'queued'}. This page will update automatically.`,
        tone: 'ok'
      });
    } catch {
      setStatus({ message: 'Build failed.', tone: 'bad' });
    } finally {
      setBuildBusy(false);
    }
  };

  const saveUploadedDocument = async () => {
    const title = documentForm.title.trim();
    const bodyText = documentForm.bodyText.trim();
    if (!title && !documentForm.filename) {
      setStatus({ message: 'Uploaded documents need a title or filename.', tone: 'bad' });
      return;
    }
    if (!bodyText && !documentForm.fileBase64) {
      setStatus({ message: 'Add document text or choose a file to upload.', tone: 'bad' });
      return;
    }

    setSavingDocument(true);
    setStatus({ message: 'Saving uploaded document...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/uploaded-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: {
            title: title || undefined,
            documentClass: documentForm.documentClass,
            bodyText: bodyText || undefined,
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
        bodyText: '',
        filename: '',
        mimeType: 'text/plain',
        fileBase64: ''
      });
      await loadWorkspace({ silent: true });
      setStatus({ message: 'Uploaded document saved. Include it in the next build to make it live.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save uploaded document.', tone: 'bad' });
    } finally {
      setSavingDocument(false);
    }
  };

  const handleDocumentFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setDocumentForm((current) => ({
        ...current,
        filename: '',
        mimeType: 'text/plain',
        fileBase64: ''
      }));
      return;
    }

    setReadingDocumentFile(true);
    try {
      const fileBase64 = await fileToBase64(file);
      setDocumentForm((current) => ({
        ...current,
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

  const publishBuild = async (buildId) => {
    setPublishingBuildId(buildId);
    setStatus({ message: `Publishing build ${buildId}...`, tone: 'warn' });
    try {
      const data = await fetchJson(`/api/v1/knowledge/builds/${encodeURIComponent(buildId)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || `Could not publish build ${buildId}.`, tone: 'bad' });
        return;
      }
      await loadWorkspace({ silent: true });
      setStatus({ message: `Build ${buildId} published.`, tone: 'ok' });
    } catch {
      setStatus({ message: `Could not publish build ${buildId}.`, tone: 'bad' });
    } finally {
      setPublishingBuildId('');
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
  const previewAnswerPacket = preview?.answerPacket || null;
  const previewAnswer = preview?.spokenAnswerEstimate || buildRepresentativeAnswer(previewAnswerPacket);
  const previewAnswerDisplay = previewBusy
    ? 'Generating answer estimate...'
    : (preview
        ? previewAnswer
        : 'Your answer preview will appear here after you test a customer question.');
  const latestBuildStatus = String(latestBuild?.status || '').trim().toLowerCase();
  const statusChip = buildState.builds.some((build) => isBuildActive(build))
    ? { tone: 'warn', label: 'Build In Progress' }
    : latestBuildStatus === 'published'
      ? { tone: 'ok', label: 'Published Build Active' }
      : latestBuildStatus === 'ready_to_publish'
        ? { tone: 'warn', label: 'Ready to Publish' }
        : { tone: 'warn', label: 'Knowledge Needs Review' };
  const activeGuide = guideByContext[activeGuideKey] || guideByContext.website;
  const activeStep = activeGuide.step || '01';
  const activeCardClassName = 'ring-2 ring-[#2563EB]/20 shadow-[0_0_0_1px_rgba(37,99,235,0.05)]';

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Knowledge"
      subtitle="Manage builds, uploaded documents, published versions, and simple question testing."
      status={status}
      statusChip={statusChip}
      headerAside={<SalesReceptionistNumberBadge />}
    >
      <div className="mt-[36px] grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="grid min-w-0 gap-3">
          <div onClick={(event) => {
            if (isInteractiveGuideTarget(event.target)) return;
            setActiveGuideKey('website');
          }}>
            <StepSection
              step="01"
              title="Create Build"
              description="A build is the knowledge set your sales receptionist uses to answer caller questions."
              contentClassName={`border-0 bg-transparent p-0 ${activeStep === '01' ? activeCardClassName : ''}`}
            >
              <div className="space-y-4">
                <div
                  className="rounded-lg border border-[#E2E8F0] bg-[#eff4ff] p-6 shadow-sm"
                  onClick={() => setActiveGuideKey('website')}
                  onFocusCapture={() => setActiveGuideKey('website')}
                >
                  <div className="mb-4">
                    <h4 className="font-['Space_Grotesk'] text-xl font-bold text-[#1E293B]">Website</h4>
                    <p className="mt-1 text-sm text-slate-500">Train the sales receptionist with up to 500 pages from your website.</p>
                  </div>
                  <label className="sr-only">Website URL</label>
                  <input
                    className="w-full rounded border-[#E2E8F0] bg-white p-3 text-sm text-slate-900 focus:border-[#2563EB] focus:ring-[#2563EB]"
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
                </div>

                <div
                  className="space-y-6 rounded-lg border border-[#E2E8F0] bg-[#eff4ff] p-6 shadow-sm"
                  onClick={() => setActiveGuideKey('documentsMeta')}
                  onFocusCapture={() => setActiveGuideKey('documentsMeta')}
                >
                  <div className="mb-2">
                    <h4 className="font-['Space_Grotesk'] text-xl font-bold text-[#1E293B]">Documents</h4>
                    <p className="mt-1 text-sm text-slate-500">
                      Information in uploaded documents takes precedence over conflicting information on the website.
                    </p>
                  </div>

                  <div
                    className="grid grid-cols-1 gap-4 md:grid-cols-2"
                    onClick={() => setActiveGuideKey('documentsMeta')}
                    onFocusCapture={() => setActiveGuideKey('documentsMeta')}
                  >
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
                  </div>

                  <div
                    className="space-y-3 pt-4"
                    onClick={() => setActiveGuideKey('documentsFile')}
                    onFocusCapture={() => setActiveGuideKey('documentsFile')}
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#2563EB]">Option A</span>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Upload File</div>
                    </div>
                    <div className="flex w-full items-center overflow-hidden rounded border border-[#E2E8F0] bg-white">
                      <label className="cursor-pointer border-r border-[#E2E8F0] bg-slate-100 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200">
                        Browse...
                        <input
                          className="hidden"
                          type="file"
                          accept=".txt,.md,.pdf,.doc,.docx"
                          onChange={handleDocumentFileChange}
                          disabled={readingDocumentFile || savingDocument}
                        />
                      </label>
                      <span className="px-4 text-xs text-slate-500">
                        {documentForm.filename || 'No file selected.'}
                      </span>
                    </div>
                    <p className="mt-2 text-[10px] italic text-slate-500">
                      Use this for PDFs or Word docs.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center py-1.5">
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="mx-4 shrink-0 bg-[#eff4ff] px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">OR</span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>
                  </div>

                  <div
                    className="space-y-3"
                    onClick={() => setActiveGuideKey('documentsText')}
                    onFocusCapture={() => setActiveGuideKey('documentsText')}
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#2563EB]">Option B</span>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Document Text</label>
                    </div>
                    <textarea
                      className="min-h-[140px] w-full rounded border-[#E2E8F0] bg-white p-3 text-sm text-slate-900 focus:border-[#2563EB] focus:ring-[#2563EB]"
                      value={documentForm.bodyText}
                      onChange={(event) => setDocumentForm((current) => ({ ...current, bodyText: event.target.value }))}
                    />
                  </div>

                  <div onClick={() => setActiveGuideKey('documentsMeta')} onFocusCapture={() => setActiveGuideKey('documentsMeta')}>
                    <Button
                      variant="outline"
                      className="border-[#2563EB] bg-transparent px-6 py-3 text-xs font-bold uppercase tracking-widest text-[#2563EB] shadow-sm hover:bg-blue-50"
                      onClick={saveUploadedDocument}
                      disabled={savingDocument || readingDocumentFile}
                    >
                      {savingDocument ? 'Saving...' : (readingDocumentFile ? 'Reading File...' : 'Save Document')}
                    </Button>

                    <div className="mt-4 grid gap-2">
                      {uploadedDocuments.length ? uploadedDocuments.map((document) => (
                        <div key={document.uploaded_document_id} className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-900">{document.title}</div>
                              <div className="text-xs text-slate-500">{document.uploaded_document_id}</div>
                            </div>
                            <span className={`badge ${document.status === 'approved' ? 'ok' : 'warn'}`}>{document.status}</span>
                          </div>
                          <div className="mt-2 text-sm text-slate-600">
                            {formatLabel(document.document_class)} · {formatLabel(document.source_authority)}
                          </div>
                          {document.filename ? (
                            <div className="mt-1 text-xs text-slate-500">File: {document.filename}</div>
                          ) : null}
                        </div>
                      )) : (
                        <p className="mt-4 text-[10px] text-slate-500">No uploaded documents yet.</p>
                      )}
                    </div>
                  </div>
                </div>

                {buildState.builds.some((build) => isBuildActive(build)) ? (
                  <div className="text-sm text-slate-600">
                    Build status auto-refreshes every 15 seconds while work is active.
                  </div>
                ) : null}

                <div className="pt-2" onClick={() => setActiveGuideKey('createBuild')} onFocusCapture={() => setActiveGuideKey('createBuild')}>
                  <Button
                    className="h-auto w-full rounded px-10 py-3 text-xs font-bold uppercase tracking-[0.18em] md:w-auto"
                    onClick={createBuild}
                    disabled={buildBusy}
                  >
                    {buildBusy ? 'Queueing...' : 'Create Build'}
                  </Button>
                </div>
              </div>
            </StepSection>
          </div>

          <div onClick={(event) => {
            if (isInteractiveGuideTarget(event.target)) return;
            setActiveGuideKey('buildHistory');
          }}>
            <StepSection
              className="mt-24"
              step="02"
              title="Build History"
              description="Review previous builds here and publish a ready version when you want it live for callers."
              contentClassName={activeStep === '02' ? activeCardClassName : ''}
            >
              <div className="grid gap-2">
                {buildState.builds.length ? buildState.builds.map((build, index) => (
                  <div key={build.build_id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900">{buildDisplayLabel(build, index)}</div>
                      </div>
                      <span className={`badge ${buildBadgeTone(build.status)}`}>{build.status}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      Cards: {build.artifact_counts_json?.cards || 0} · Facts: {build.artifact_counts_json?.facts || 0}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{renderBuildProgress(build)}</div>
                    <BuildProgressMeter build={build} compact />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {build.status === 'ready_to_publish' ? (
                        <Button
                          variant="outline"
                          onClick={() => publishBuild(build.build_id)}
                          disabled={publishingBuildId === build.build_id}
                        >
                          {publishingBuildId === build.build_id ? 'Publishing...' : 'Publish'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )) : (
                  <div className="text-sm text-slate-500">Publish a knowledge build so the sales receptionist can answer questions about your business.</div>
                )}
              </div>
            </StepSection>
          </div>

          <div onClick={(event) => {
            if (isInteractiveGuideTarget(event.target)) return;
            setActiveGuideKey('testQuestion');
          }}>
            <StepSection
              className="mt-24"
              step="03"
              title="Test Customer Questions"
              description="Ask a caller-style question to see an approximate answer based on the current published build."
              contentClassName={activeStep === '03' ? activeCardClassName : ''}
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
        </div>

        <GuidePanel
          title="Knowledge Guide"
          eyebrow={`Step ${activeStep}`}
          icon="architecture"
          className="self-start xl:sticky xl:top-32 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto"
        >
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
    </SectionPage>
  );
}
