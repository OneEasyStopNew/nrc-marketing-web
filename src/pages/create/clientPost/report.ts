import type { ClientCheck, ClientPost, PartFinding } from '@/api/clientPosts';

/**
 * A self-contained HTML record of one check of a client post (NRC-41), built
 * in the browser from the persisted check: nothing is re-run. All text is
 * escaped; there are no scripts or remote resources. It is never called an
 * approval.
 */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const OUTCOME: Record<string, string> = { PASS: 'Passed the assessed checks', FAIL: 'Failed', NEEDS_REVIEW: 'Needs review' };
const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function finding(f: PartFinding): string {
  const where = f.offending_excerpt ? `<p>Text: “${esc(f.offending_excerpt)}”</p>` : '';
  const when = f.time_range ? `<p>From ${time(f.time_range.start_s)} to ${time(f.time_range.end_s)}</p>` : '';
  const fix = f.suggested_correction ? `<p>Suggested: ${esc(f.suggested_correction)}</p>` : '';
  return `<li><strong>${esc(f.severity)} · ${esc(f.rule_id)} v${f.rule_version}</strong><p>${esc(f.explanation)}</p>${where}${when}${fix}`
    + `<p class="src">Source ${esc(f.source.source_id)}, ${esc(f.source.clause)}</p></li>`;
}

export function clientCheckReport(post: ClientPost, check: ClientCheck, studyTitle: string): string {
  const fileName = (assetId: string | null) => post.media.find((m) => m.asset_id === assetId)?.file_name ?? 'File';
  const parts = check.parts.map((p) => {
    const title = p.target === 'caption' ? 'Caption' : `${p.target === 'video' ? 'Video' : 'Image'}: ${fileName(p.asset_id)}`;
    const gaps = p.coverage_gaps.length ? `<p><strong>Not assessed:</strong> ${p.coverage_gaps.map((g) => esc(g.reason)).join(' ')}</p>` : '';
    const list = p.findings.length ? `<ol>${p.findings.map(finding).join('')}</ol>` : '<p>No findings reported for this part.</p>';
    const result = p.outcome === 'PASS' && p.coverage_gaps.length ? 'Partly assessed' : p.outcome ? OUTCOME[p.outcome] : 'No result';
    return `<section><h2>${esc(title)} · ${esc(result)}</h2>${list}${gaps}</section>`;
  }).join('');
  const current = check.is_current && check.post_version === post.version;
  const headline = check.outcome === 'PASS' && check.parts.some((p) => p.coverage_gaps.length)
    ? 'Passed what could be assessed; some parts were not assessed'
    : check.outcome ? OUTCOME[check.outcome] : 'No result';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Check report, post version ${check.post_version}</title>`
    + '<style>body{font:15px/1.5 system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#1f2937}'
    + 'h1{font-size:22px}h2{font-size:17px;margin-top:28px}li{margin:12px 0;overflow-wrap:anywhere}.src{color:#6b7280}'
    + 'dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px}dt{color:#6b7280}@media print{body{margin:0}}</style></head><body>'
    + '<h1>Check report: client post (validation only)</h1>'
    + `<p><strong>${esc(headline)}</strong>${current ? '' : ' · out of date: the post changed after this check'}.`
    + ' This is an automated check, not an approval. A reviewer approves separately.</p>'
    + `<dl><dt>Study</dt><dd>${esc(studyTitle)} (snapshot version ${check.study_snapshot_version})</dd>`
    + `<dt>Policy rules</dt><dd>${check.policy_bundle_version != null ? `version ${check.policy_bundle_version}` : 'not reported'}</dd>`
    + `<dt>Post</dt><dd>version ${check.post_version} · ${esc(post.channel)} ${esc(post.post_format)} · ${esc(post.language)}</dd>`
    + `<dt>Check</dt><dd>${esc(check.check_id)} · evaluated ${esc(check.evaluated_at ?? 'not yet')}</dd>`
    + `<dt>AI generation</dt><dd>${check.generation_requests} requests by the check</dd>`
    + `<dt>Paid AI fixes</dt><dd>${post.generation_requests} requests chosen by the user for this post</dd></dl>`
    + `<h2>Caption checked</h2><p>${post.caption ? esc(post.caption).replace(/\n/g, '<br>') : 'No caption.'}</p>`
    + parts + '</body></html>';
}
