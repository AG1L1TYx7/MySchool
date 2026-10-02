'use client';

import { useParams } from 'next/navigation';
import { MessagesView } from '@/components/messages-view';

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  return <MessagesView selectedId={id} />;
}
