import type { ReactElement } from 'react';
import { Blockquote } from '@astryxdesign/core/Blockquote';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { List, ListItem } from '@astryxdesign/core/List';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { ContextEvidence, ContextRule, ValidationContext } from '@/api/validations';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Misc';
import { missingContextNote, rulesWithEvidence, unlinkedEvidence, type RuleEvidence } from './evidence';
import { SeverityBadge } from './parts';

const NODE_TYPE: Record<ContextEvidence['node_type'], string> = {
  RULE: 'Rule', CLAUSE: 'Clause', DISCLOSURE: 'Disclosure', EXCEPTION: 'Exception', INTERPRETATION: 'Interpretation', EXAMPLE: 'Example',
};
const CHECKED_BY: Record<ContextRule['check_type'], string> = { semantic: 'Checked by the model', deterministic: 'Checked by code' };
const APPLIES: Record<ValidationContext['exceptions'][number]['applicable'], [BadgeVariant, string]> = {
  true: ['waiting', 'Applies'], false: ['neutral', 'Does not apply'], unresolved: ['waiting', 'Not settled'],
};

/** One piece of source text, exactly as the policy stores it. */
function Source({ e }: { e: ContextEvidence }) {
  const where = `${NODE_TYPE[e.node_type]} ${e.clause_ref ?? e.node_key}${e.matches.length > 0 ? ' · found by the search of the checked text' : ''}`;
  return (
    <VStack gap={1}>
      <Text type="supporting" color="secondary">{where}</Text>
      <Blockquote>{e.excerpt}</Blockquote>
    </VStack>
  );
}

function RuleRow({ item, title }: { item: RuleEvidence; title?: string }) {
  const { rule, required, sources } = item;
  return (
    <ListItem align="start"
      label={(
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text type="body" weight="semibold">{`${rule.rule_id} v${rule.rule_version}${title ? ` · ${title}` : ''}`}</Text>
          <Badge variant={required ? 'regulatory' : 'neutral'}>{required ? 'Required' : 'Optional'}</Badge>
          <SeverityBadge severity={rule.severity} />
          <Text type="supporting" color="secondary">{CHECKED_BY[rule.check_type]}</Text>
        </HStack>
      )}
      description={(
        <VStack gap={2}>
          {rule.unresolved.length > 0 && (
            <Text type="body" color="secondary">{`Could not be settled: ${rule.unresolved.join(', ')}. The rule was kept.`}</Text>
          )}
          {sources.length > 0
            ? (
              <Collapsible trigger={`Source text (${sources.length})`} defaultIsOpen={false}>
                <VStack gap={3}>{sources.map((e) => <Source key={e.node_key} e={e} />)}</VStack>
              </Collapsible>
            )
            : <Text type="supporting" color="secondary">No source text was stored for this rule.</Text>}
        </VStack>
      )} />
  );
}

/**
 * The policy context of one validation run (NRC-5): the rules it was checked
 * against and the source text behind each. Evidence only: the result comes
 * from the run's own checks, and an incomplete context is never a pass.
 */
export function PolicyEvidence({ context, ruleTitle }: {
  context: ValidationContext;
  /** The rule's title from the active policy, when it still has that version. */
  ruleTitle?: (ruleId: string, ruleVersion: number) => string | undefined;
}): ReactElement {
  const rules = rulesWithEvidence(context);
  const other = unlinkedEvidence(context);
  return (
    <VStack gap={4}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="body">{`Policy rules version ${context.policy_bundle_version}, study snapshot version ${context.study_snapshot_version}`}</Text>
        {context.is_synthetic && <Badge variant="waiting">Synthetic rules</Badge>}
      </HStack>
      <Text type="supporting" color="secondary">
        These are the rules this run was checked against and the text behind them. They are evidence, not a result: the result above comes from the run&apos;s own checks.
      </Text>

      {context.missing_context.length > 0 && (
        <Alert tone="waiting" title="The policy context is not complete">
          <VStack gap={1}>
            {context.missing_context.map((m, i) => <Text key={i} type="body" wordBreak="break-word">{missingContextNote(m)}</Text>)}
            <Text type="body">An incomplete context never counts as a pass.</Text>
          </VStack>
        </Alert>
      )}

      {rules.length > 0
        ? (
          <List hasDividers aria-label="Rules this run was checked against">
            {rules.map((item) => (
              <RuleRow key={`${item.rule.node_key}-${item.rule.rule_version}`} item={item} title={ruleTitle?.(item.rule.rule_id, item.rule.rule_version)} />
            ))}
          </List>
        )
        : <Text type="body" color="secondary">No rules were selected for this run.</Text>}

      {context.exceptions.length > 0 && (
        <VStack gap={2}>
          <Heading level={3}>Exceptions</Heading>
          <List hasDividers aria-label="Exceptions to the rules">
            {context.exceptions.map((x) => (
              <ListItem key={`${x.for_rule_id}-${x.node_key}`} align="start"
                label={(
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Text type="body" weight="semibold">{`Exception to ${x.for_rule_id}`}</Text>
                    <Badge variant={APPLIES[x.applicable][0]}>{APPLIES[x.applicable][1]}</Badge>
                  </HStack>
                )}
                description={(
                  <VStack gap={1}>
                    {x.reasons.length > 0 && <Text type="body" color="secondary">{x.reasons.join('; ')}</Text>}
                    <Blockquote>{x.excerpt}</Blockquote>
                  </VStack>
                )} />
            ))}
          </List>
        </VStack>
      )}

      {context.superseded.length > 0 && (
        <VStack gap={1}>
          <Heading level={3}>Replaced rules</Heading>
          {context.superseded.map((s) => <Text key={`${s.rule_id}-${s.superseded_by}`} type="body">{`${s.rule_id} was replaced by ${s.superseded_by}.`}</Text>)}
        </VStack>
      )}

      {other.length > 0 && (
        <VStack gap={2}>
          <Heading level={3}>Other source text</Heading>
          {other.map((e) => <Source key={e.node_key} e={e} />)}
        </VStack>
      )}
    </VStack>
  );
}
