import { useState, type ReactElement } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useSession } from '@/auth/AuthProvider';
import { isApiError } from '@/api/errors';
import {
  bundleConflict,
  commandsFor,
  commandsForOthers,
  needsReason,
  policyAdminApi,
  type BundleCommand,
  type PolicyBundleDetail,
} from '@/api/policyAdmin';
import { Button } from '@/components/ui/Button';
import { Card, CardHead } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { ISSUE_WORD, STATE_WORD } from './labels';
import { useRulebookChange } from './useRulebooks';

/**
 * The status buttons of one rulebook (NRC-20). Only the commands the viewer's
 * role may run in this status are offered; the ones another role holds are
 * named, so nobody wonders why a button is missing. Every command asks for
 * confirmation and says what happens; reject, activate, roll back and retire
 * also ask for a reason. The API stays the authority (403, 409, 412).
 */

const COMMAND: Record<BundleCommand, { label: string; does: (b: PolicyBundleDetail) => string; danger?: boolean }> = {
  submit: { label: 'Send for review', does: () => 'The policy owner will approve or reject it. It cannot be edited while it is in review.' },
  approve: { label: 'Approve', does: () => 'It becomes approved and its search index is built. It is not in use until a policy administrator activates it.' },
  reject: { label: 'Reject', does: () => 'It is rejected and stays in the history. It can never be activated.', danger: true },
  return_to_draft: { label: 'Return to draft', does: () => 'It goes back to draft so it can be changed, then sent for review again.' },
  build: { label: 'Build again', does: () => 'The search index is built again after the failed build. It still needs activating afterwards.' },
  activate: {
    label: 'Activate',
    does: (b) => `Version ${b.version} becomes the rulebook every brief, caption and image is checked against. The version in use now is retired. Validation results and approvals made under it are marked out of date.`,
  },
  rollback: {
    label: 'Roll back to this version',
    does: (b) => `Version ${b.version} becomes active again. The version in use now is retired. Validation results and approvals made under it are marked out of date.`,
  },
  retire: {
    label: 'Retire',
    does: () => 'It stops being used. Until another version is activated, there is no active rulebook and validation cannot pass anything.',
    danger: true,
  },
};

const WHO: Record<BundleCommand, string> = {
  submit: 'a policy administrator', return_to_draft: 'a policy administrator or the policy owner', approve: 'the policy owner',
  reject: 'the policy owner', build: 'a policy administrator', activate: 'a policy administrator', rollback: 'a policy administrator', retire: 'a policy administrator',
};

export function Lifecycle({ bundle: b }: { bundle: PolicyBundleDetail }): ReactElement {
  const caps = useSession().context.capabilities;
  const wasActive = !!b.activated_at;
  const mine = commandsFor(b.lifecycle_state, caps, wasActive);
  const others = commandsForOthers(b.lifecycle_state, caps, wasActive);
  const [open, setOpen] = useState<BundleCommand | null>(null);

  return (
    <Card aria-label="Status actions">
      <CardHead title="Status actions" icon="shield" />
      {mine.length === 0 && others.length === 0 && (
        <Text type="body" color="secondary">{`Nothing can be done with a rulebook that is ${STATE_WORD[b.lifecycle_state][1].toLowerCase()}.`}</Text>
      )}
      {mine.length > 0 && (
        <HStack gap={2} wrap="wrap">
          {mine.map((c, i) => (
            <Button key={c} variant={i === 0 && !COMMAND[c].danger ? 'primary' : 'secondary'} onClick={() => setOpen(c)}>{COMMAND[c].label}</Button>
          ))}
        </HStack>
      )}
      {others.length > 0 && (
        <VStack gap={1}>
          {others.map((c) => (
            <Text key={c} type="supporting" color="secondary">{`${COMMAND[c].label}: only ${WHO[c]} can do this.`}</Text>
          ))}
        </VStack>
      )}
      {open && <ConfirmCommand bundle={b} command={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function ConfirmCommand({ bundle: b, command, onClose }: { bundle: PolicyBundleDetail; command: BundleCommand; onClose: () => void }): ReactElement {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const change = useRulebookChange((why: string | null) => policyAdminApi.transition(b.id, b.revision, command, why));
  const spec = COMMAND[command];
  const reasonNeeded = needsReason(command);
  const failure = change.error ? failureOf(change.error) : null;

  const run = () => {
    if (reasonNeeded && !reason.trim()) { setMissing(true); return; }
    change.mutate([reasonNeeded ? reason : null], {
      onSuccess: (next) => {
        toast(`Version ${next.version} is now ${STATE_WORD[next.lifecycle_state][1].toLowerCase()}`, 'done');
        onClose();
      },
    });
  };

  return (
    <Modal open onClose={onClose} title={`${spec.label}: version ${b.version}`}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={spec.danger ? 'danger' : 'primary'} loading={change.isPending} onClick={run}>{spec.label}</Button>
        </>
      )}>
      <VStack gap={4}>
        <Text type="body">{spec.does(b)}</Text>
        {reasonNeeded && (
          <Textarea label="Reason" required rows={3} limit={1000} value={reason}
            help="Kept in the history with your name."
            error={missing && !reason.trim() ? 'Give a reason.' : undefined}
            onChange={(e) => setReason(e.target.value)} />
        )}
        {failure}
      </VStack>
    </Modal>
  );
}

/** What went wrong, in words, with the blocking problems listed when the server sends them. */
function failureOf(e: Error): ReactElement {
  const conflict = bundleConflict(e);
  if (conflict?.kind === 'issues') {
    return (
      <Alert tone="blocked" title="Problems block this">
        <VStack gap={1}>
          {conflict.issues.map((i, n) => <Text key={`${i.subject}-${n}`} type="body" wordBreak="break-word">{`${ISSUE_WORD[i.code]}: ${i.message}`}</Text>)}
        </VStack>
      </Alert>
    );
  }
  if (conflict?.kind === 'state') {
    return <Alert tone="blocked" title="The status changed">{`This rulebook is now ${STATE_WORD[conflict.state][1].toLowerCase()}. Close this and look again.`}</Alert>;
  }
  if (isApiError(e) && e.kind === 'stale') return <Alert tone="blocked" title="Someone changed this rulebook">Close this; the page shows the latest version. Then try again.</Alert>;
  if (isApiError(e) && e.kind === 'forbidden') return <Alert tone="blocked" title="Not allowed">Your role cannot do this. Nothing was changed.</Alert>;
  return <Alert tone="blocked" title="It did not work">{isApiError(e) ? e.message : 'Try again in a moment. Nothing was changed.'}</Alert>;
}
