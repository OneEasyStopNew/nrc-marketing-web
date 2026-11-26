import { Fragment, useState, type ReactElement } from 'react';
import { Blockquote } from '@astryxdesign/core/Blockquote';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { useSession } from '@/auth/AuthProvider';
import { canEditBundle, type PolicyBundleDetail, type PolicyEdge, type PolicyNode, type PolicyRuleRecord } from '@/api/policyAdmin';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHead } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Misc';
import { GATE_LABEL, QueryState, SeverityBadge } from '@/pages/shared/ui';
import { RuleForm, WordingForm } from './Editing';
import { NODE_TYPE_WORD, ORIGIN_WORD, ReviewBadge, WORDING_KIND_WORD } from './labels';
import { ReviewButtons } from './Review';
import { useRulebookEdges, useRulebookNodes, useRulebookRules } from './useRulebooks';

/**
 * The rules of one rulebook with what each is linked to (NRC-20 evidence view):
 * rule → exception or required disclosure → source clause, each with its review
 * state, plus a coverage summary of the mandatory rules. A readable list, not a
 * graph editor. Wording is shown exactly as the API supplies it.
 */

const EDGE_WORD: Record<PolicyEdge['edge_type'], string> = {
  supported_by: 'Comes from',
  requires_disclosure: 'Needs this disclosure',
  except_when: 'Except when',
  supersedes: 'Replaces',
  applies_to: 'Applies to',
};

interface Graph { nodes: Map<string, PolicyNode>; edgesFrom: Map<string, PolicyEdge[]> }

function graphOf(nodes: PolicyNode[], edges: PolicyEdge[]): Graph {
  const edgesFrom = new Map<string, PolicyEdge[]>();
  for (const e of edges) edgesFrom.set(e.from_node_id, [...(edgesFrom.get(e.from_node_id) ?? []), e]);
  return { nodes: new Map(nodes.map((n) => [n.id, n])), edgesFrom };
}

/** A mandatory rule is covered when it and every link it has are reviewed, and it names where it comes from. */
function gapsOf(r: PolicyRuleRecord, g: Graph): string[] {
  const links = g.edgesFrom.get(r.node.id) ?? [];
  const gaps: string[] = [];
  if (r.node.review_state !== 'APPROVED') gaps.push('the rule is not reviewed');
  if (!r.node.source_clause_id && !links.some((e) => e.edge_type === 'supported_by')) gaps.push('no source');
  if (links.some((e) => e.review_state !== 'APPROVED' || g.nodes.get(e.to_node_id)?.review_state !== 'APPROVED')) gaps.push('a linked item is not reviewed');
  return gaps;
}

export function RulesList({ bundle }: { bundle: PolicyBundleDetail }): ReactElement {
  const rules = useRulebookRules(bundle.id);
  const nodes = useRulebookNodes(bundle.id);
  const edges = useRulebookEdges(bundle.id);
  const graph = graphOf(nodes.data ?? [], edges.data ?? []);
  const editable = canEditBundle(bundle.lifecycle_state, useSession().context.capabilities);
  const [form, setForm] = useState<{ kind: 'rule' | 'wording'; rule?: PolicyRuleRecord } | null>(null);

  return (
    <>
      <QueryState query={rules} what="the rules in this rulebook">
        {(list) => <Coverage rules={list} graph={graph} ready={!!nodes.data && !!edges.data} />}
      </QueryState>
      <Card aria-label="Rules">
        <CardHead title={`Rules (${bundle.rule_count})`} icon="doc">
          {editable && <Button variant="secondary" icon="plus" onClick={() => setForm({ kind: 'rule' })}>Add a rule</Button>}
        </CardHead>
        <QueryState query={rules} what="the rules in this rulebook">
          {(list) => (
            <VStack gap={4}>
              {list.map((r, i) => (
                <Fragment key={r.id}>
                  {i > 0 && <Divider />}
                  <RuleItem bundle={bundle} rule={r} graph={graph} editable={editable}
                    onEdit={() => setForm({ kind: 'rule', rule: r })} onAddWording={() => setForm({ kind: 'wording', rule: r })} />
                </Fragment>
              ))}
            </VStack>
          )}
        </QueryState>
      </Card>
      {form?.kind === 'rule' && <RuleForm bundle={bundle} rule={form.rule} onClose={() => setForm(null)} />}
      {form?.kind === 'wording' && form.rule && <WordingForm bundle={bundle} rule={form.rule} onClose={() => setForm(null)} />}
    </>
  );
}

function Coverage({ rules, graph, ready }: { rules: PolicyRuleRecord[]; graph: Graph; ready: boolean }): ReactElement | null {
  if (!ready) return null;
  const mandatory = rules.filter((r) => r.mandatory);
  const open = mandatory.map((r) => ({ r, gaps: gapsOf(r, graph) })).filter((x) => x.gaps.length > 0);
  return (
    <Card aria-label="Mandatory rule coverage">
      <CardHead title="Mandatory rule coverage" icon="shield" />
      <Text type="body">{`${mandatory.length - open.length} of ${mandatory.length} mandatory rules are reviewed, linked to a source, and have only reviewed links.`}</Text>
      {open.length > 0 && (
        <Alert tone="waiting" title="Not covered yet">
          <VStack gap={1}>
            {open.map(({ r, gaps }) => <Text key={r.id} type="body" wordBreak="break-word">{`${r.rule_id}: ${gaps.join(', ')}`}</Text>)}
          </VStack>
        </Alert>
      )}
    </Card>
  );
}

function RuleItem({ bundle, rule: r, graph, editable, onEdit, onAddWording }: {
  bundle: PolicyBundleDetail; rule: PolicyRuleRecord; graph: Graph; editable: boolean; onEdit: () => void; onAddWording: () => void;
}): ReactElement {
  const links = graph.edgesFrom.get(r.node.id) ?? [];
  return (
    <section aria-label={`Rule ${r.rule_id}`}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Heading level={4}>{`${r.rule_id} · version ${r.rule_version}`}</Heading>
          <SeverityBadge value={r.severity} />
          <Badge variant={r.mandatory ? 'blocked' : 'neutral'}>{r.mandatory ? 'Mandatory' : 'Optional'}</Badge>
          <ReviewBadge state={r.node.review_state} />
        </HStack>
        <Text type="body" wordBreak="break-word">{r.title}</Text>
        <Blockquote>{r.requirement}</Blockquote>
        <Text type="supporting" color="secondary">
          {`${GATE_LABEL[r.gate] ?? r.gate} · ${r.check_type === 'deterministic' ? 'Checked by exact rules' : 'Checked by meaning (AI)'} · ${ORIGIN_WORD[r.node.origin]}`}
        </Text>
        {r.node.review_state === 'PROPOSED' && (
          <ReviewButtons bundle={bundle} item={{ kind: 'node', nodeType: r.node.node_type }} id={r.node.id} name={`rule ${r.rule_id}`} />
        )}
        {editable && (
          <HStack gap={2} wrap="wrap">
            <Button size="sm" variant="secondary" icon="edit" aria-label={`Edit ${r.rule_id}`} onClick={onEdit}>Edit</Button>
            <Button size="sm" variant="secondary" icon="plus" aria-label={`Add wording to ${r.rule_id}`} onClick={onAddWording}>Add wording</Button>
          </HStack>
        )}

        {r.wordings.map((w) => (
          <VStack key={w.id} gap={1}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text type="label">{WORDING_KIND_WORD[w.kind]}</Text>
              <ReviewBadge state={w.review_state} />
              {w.origin !== 'HUMAN' && <Text type="supporting" color="secondary">{ORIGIN_WORD[w.origin]}</Text>}
            </HStack>
            <Blockquote>{w.text}</Blockquote>
            {w.review_state === 'PROPOSED' && (
              <ReviewButtons bundle={bundle} item={{ kind: 'wording', wordingKind: w.kind }} id={w.id} name={`${WORDING_KIND_WORD[w.kind].toLowerCase()} of ${r.rule_id}`} />
            )}
          </VStack>
        ))}

        {links.length > 0 && (
          <VStack gap={2}>
            <Text type="label">Linked items</Text>
            {links.map((e) => <LinkedItem key={e.id} bundle={bundle} edge={e} to={graph.nodes.get(e.to_node_id)} ruleId={r.rule_id} />)}
          </VStack>
        )}
      </VStack>
    </section>
  );
}

function LinkedItem({ bundle, edge: e, to, ruleId }: { bundle: PolicyBundleDetail; edge: PolicyEdge; to: PolicyNode | undefined; ruleId: string }): ReactElement {
  const what = to ? `${NODE_TYPE_WORD[to.node_type].toLowerCase()} ${to.node_key}` : 'an item';
  return (
    <VStack gap={1}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="body" weight="semibold">{`${EDGE_WORD[e.edge_type]}: ${to ? `${NODE_TYPE_WORD[to.node_type]} ${to.node_key}` : 'an item not in this list'}`}</Text>
        {to && <ReviewBadge state={to.review_state} />}
        {e.review_state !== 'APPROVED' && <Text type="supporting" color="secondary">The link itself is not reviewed</Text>}
      </HStack>
      {to && <Blockquote>{to.text}</Blockquote>}
      {to?.review_state === 'PROPOSED' && (
        <ReviewButtons bundle={bundle} item={{ kind: 'node', nodeType: to.node_type }} id={to.id} name={`${what} of ${ruleId}`} />
      )}
      {e.review_state === 'PROPOSED' && (
        <ReviewButtons bundle={bundle} item={{ kind: 'edge' }} id={e.id} name={`the link from ${ruleId} to ${what}`} />
      )}
    </VStack>
  );
}
