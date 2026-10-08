/** Library (docs/02 sections 10 and 30, slice 22): shared content with versions, collections, review and semantic search. */

export type LibraryKind = 'h5p' | 'document' | 'link' | 'lesson_plan';
export type Visibility = 'private' | 'school' | 'district' | 'public';
export type ItemStatus = 'draft' | 'pending_review' | 'published' | 'rejected' | 'archived';

export interface LibraryItem {
  id: string;
  organizationId: string;
  organizationName: string;
  kind: LibraryKind;
  title: string;
  description: string | null;
  subject: string | null;
  gradeLevel: string | null;
  topics: string[];
  standards: string[];
  keywords: string | null;
  visibility: Visibility;
  status: ItemStatus;
  version: number;
  featured: boolean;
  h5pContentId: string | null;
  h5p: { contentType: string; library: string; status: string } | null;
  fileId: string | null;
  file: { name: string; mimeType: string; sizeBytes: number } | null;
  url: string | null;
  lessonPlanId: string | null;
  lessonPlan: { topic: string } | null;
  createdBy: string | null;
  createdById: string | null;
  sourceItemId: string | null;
  counts: { views: number; downloads: number; copies: number };
  rating: { average: number | null; count: number };
  reviewNote: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canReview: boolean;
  score?: number | null;
}

export interface LibraryItemDetail extends LibraryItem {
  versions: Array<{ version: number; title: string; note: string | null; createdAt: string; createdById: string | null }>;
  myRating: { stars: number; comment: string | null } | null;
  collections: Array<{ id: string; title: string }>;
}

export interface Collection {
  id: string;
  organizationId: string;
  organizationName: string;
  title: string;
  description: string | null;
  visibility: Visibility;
  featured: boolean;
  createdBy: string | null;
  itemCount: number;
  followerCount: number;
  following: boolean;
  canEdit: boolean;
  items?: LibraryItem[];
}

export interface ModerationQueue {
  pending: LibraryItem[];
  flags: Array<{ id: string; reason: string; reportedBy: string; createdAt: string; item: LibraryItem }>;
}

export const KIND_LABELS: Record<LibraryKind, string> = { h5p: 'Interactive', document: 'Document', link: 'Link', lesson_plan: 'Lesson plan' };
export const VISIBILITY_LABELS: Record<Visibility, string> = { private: 'Only me', school: 'My school', district: 'My district', public: 'Everyone' };
export const VISIBILITY_HELP: Record<Visibility, string> = {
  private: 'Only you can open it.',
  school: 'Everyone at your school. Published at once.',
  district: 'Every school in your district. A school administrator reviews it first.',
  public: 'Every SmartSchool school. A district administrator reviews it first.',
};
export const STATUS_LABELS: Record<ItemStatus, string> = { draft: 'Draft', pending_review: 'Waiting for review', published: 'Published', rejected: 'Taken down', archived: 'Archived' };
export const FLAG_LABELS: Record<string, string> = { inaccurate: 'Not accurate', inappropriate: 'Not appropriate for students', copyright: 'Copyright concern', broken: 'Does not work', other: 'Something else' };

export const statusClass = (s: ItemStatus) => (s === 'published' ? 'bg-emerald-100 text-emerald-800' : s === 'pending_review' ? 'bg-amber-100 text-amber-800' : s === 'rejected' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700');
export const stars = (n: number | null) => (n === null ? 'Not rated yet' : `${n} of 5`);
