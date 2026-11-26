import { useState, type ReactElement } from 'react';
import { HStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import type { ClientPost } from '@/api/clientPosts';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { MoveButtons, moveItem } from './order';

/**
 * The order the carousel images are posted in. Changing it saves a new
 * version, because the order is part of what was checked. Remount it with
 * key={post.version} so a new version starts from the saved order.
 */
export function CarouselOrder({ post, canEdit, saving, onSave }: {
  post: ClientPost;
  canEdit: boolean;
  saving: boolean;
  onSave: (body: { asset_ids: string[]; change_note: string }) => Promise<boolean>;
}): ReactElement | null {
  const [order, setOrder] = useState(() => post.media.map((m) => m.asset_id));
  if (post.media.length < 2) return null;

  const byId = new Map(post.media.map((m) => [m.asset_id, m]));
  const changed = order.join() !== post.media.map((m) => m.asset_id).join();

  return (
    <Card>
      <CardHead title="Image order" icon="sort" />
      <CardBody>
        <Text type="body" color="secondary">
          The carousel shows the images in this order. A new order saves as version {post.version + 1} and must be checked again.
        </Text>
        <List hasDividers density="compact" aria-label="Carousel order">
          {order.map((assetId, i) => {
            const name = byId.get(assetId)?.file_name ?? assetId;
            return (
              <ListItem key={assetId}
                label={<Text type="body" wordBreak="break-word">{i + 1}. {name}</Text>}
                endContent={canEdit ? <MoveButtons index={i} count={order.length} name={name} disabled={saving} onMove={(from, to) => setOrder((o) => moveItem(o, from, to))} /> : undefined} />
            );
          })}
        </List>
        {canEdit && changed && (
          <HStack gap={2} wrap="wrap">
            <Button variant="secondary" icon="check" loading={saving}
              onClick={() => void onSave({ asset_ids: order, change_note: 'Changed the image order' })}>
              Save order as version {post.version + 1}
            </Button>
            <Button variant="ghost" onClick={() => setOrder(post.media.map((m) => m.asset_id))}>Undo</Button>
          </HStack>
        )}
      </CardBody>
    </Card>
  );
}
