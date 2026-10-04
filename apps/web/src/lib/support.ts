/** Support and safety (docs/13 section 6): accommodations, counselor caseloads, wellness queue, behaviour, AI consent. */

export interface Accommodation {
  studentId: string;
  plan: 'iep' | 'section_504' | 'other';
  extendedTimePercent: number;
  readAloud: boolean;
  largeText: boolean;
  reducedMotion: boolean;
  reducedDistraction: boolean;
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  updatedAt: string;
}
export interface MyAccommodations {
  extendedTimePercent: number;
  readAloud: boolean;
  largeText: boolean;
  reducedMotion: boolean;
  reducedDistraction: boolean;
}
export const NO_ACCOMMODATIONS: MyAccommodations = { extendedTimePercent: 0, readAloud: false, largeText: false, reducedMotion: false, reducedDistraction: false };

export interface CaseloadEntry {
  student: { id: string; studentNumber: string; firstName: string; lastName: string; gradeLevel: string | null };
  reason: string | null;
  assignedAt: string;
  openAlerts: number;
}
export interface CounselorNote {
  id: string;
  body: string;
  author: { id: string; firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}
export interface WellnessAlert {
  id: string;
  student: { id: string; studentNumber: string; firstName: string; lastName: string; gradeLevel: string | null } | null;
  categories: string[];
  excerpt: string;
  status: 'open' | 'acknowledged' | 'resolved';
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  resolution: string | null;
  conversationId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
export interface BehaviorRecord {
  id: string;
  studentId: string;
  kind: 'positive' | 'concern' | 'incident';
  title: string;
  description: string | null;
  occurredAt: string;
  location: string | null;
  actionTaken: string | null;
  parentVisible: boolean | null;
  visibleToFamily: boolean;
  reportedBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
  canEdit: boolean;
}
export interface AiConsent {
  studentId: string;
  under13: boolean;
  schoolDefault: 'school' | 'parent';
  status: 'granted' | 'declined' | 'pending';
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  allowed: boolean;
  reason: 'adult' | 'parent_granted' | 'parent_declined' | 'school_default' | 'parent_required';
}
export interface SupportSettings {
  behaviorVisibility: 'ALL' | 'POSITIVE_ONLY' | 'NONE';
  aiConsentDefault: 'SCHOOL' | 'PARENT';
  studentMessaging: boolean;
}

export const PLAN_LABELS: Record<Accommodation['plan'], string> = { iep: 'IEP', section_504: 'Section 504 plan', other: 'Other plan' };
export const KIND_LABELS: Record<BehaviorRecord['kind'], string> = { positive: 'Positive', concern: 'Concern', incident: 'Incident' };
export const KIND_TONES: Record<BehaviorRecord['kind'], string> = { positive: 'bg-green-100 text-green-800', concern: 'bg-amber-100 text-amber-900', incident: 'bg-red-100 text-red-800' };
export const CONSENT_REASONS: Record<AiConsent['reason'], string> = {
  adult: 'The student is 13 or older, so no extra consent is needed.',
  parent_granted: 'A parent or guardian said yes.',
  parent_declined: 'A parent or guardian turned AI features off for this student.',
  school_default: 'The school consents on behalf of parents; a parent can still opt out here.',
  parent_required: 'The school asks parents to decide. AI features stay off until a parent says yes.',
};
