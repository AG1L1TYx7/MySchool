/** District and tenancy (docs/13 section 9, slice 20): every school on one page, policy switches, state exports and hosting. */

import { api } from '@/lib/api';

export interface SchoolRow {
  organizationId: string;
  name: string;
  students: number;
  staff: number;
  attendanceRate30: number | null;
  presentToday: number | null;
  missingItems: number;
  failing: number;
  gradebookCompleteness: number | null;
  aiConversations7: number;
  openIncidents: number;
}

export interface DistrictOverview {
  tenant: { id: string; name: string; slug: string };
  generatedAt: string;
  totals: {
    schools: number;
    students: number;
    staff: number;
    attendanceRate30: number | null;
    presentToday: number | null;
    missingItems: number;
    failing: number;
    gradebookCompleteness: number | null;
    aiConversations7: number;
    openIncidents: number;
  };
  schools: SchoolRow[];
}

export interface TenantPolicies {
  aiEnabled: boolean;
  aiDisabledSchools: string[];
  studentMessagingAllowed: boolean;
  disabledFeatures: string[];
  retention: Record<string, number>;
}

export interface Branding {
  displayName?: string | null;
  primaryColor?: string | null;
  logoUrl?: string | null;
  supportEmail?: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'trial';
  customDomain: string | null;
  domainVerifiedAt: string | null;
  verification: { name: string; value: string } | null;
  branding: Branding;
  policies: TenantPolicies;
  schools: number;
  createdAt: string;
}

export interface PublicBranding extends Branding {
  tenant: { id: string; slug: string; name: string; status: string } | null;
  displayName: string;
}

export const DISTRICT_REPORTS: Array<{ kind: string; label: string; about: string }> = [
  { kind: 'schools', label: 'Schools at a glance', about: 'One row per school: students, staff, attendance, missing work, failing, gradebook completeness, AI use, open incidents.' },
  { kind: 'enrollment_by_grade', label: 'Enrollment by grade', about: 'Active students per school and grade level.' },
  { kind: 'attendance_daily', label: 'Daily attendance', about: 'Records and present rate per school per day, last 30 days.' },
  { kind: 'ai_usage', label: 'AI usage', about: 'Conversations and messages per school and capability, last 7 days.' },
];

export const STATE_EXPORTS: Array<{ kind: string; label: string; about: string }> = [
  { kind: 'enrollment', label: 'Enrollment', about: 'Student roster with school code, date of birth, grade and status.' },
  { kind: 'attendance', label: 'Attendance', about: 'Days present, absent, excused and tardy per student with average daily attendance, last 365 days.' },
  { kind: 'discipline', label: 'Discipline', about: 'Behaviour concerns with date, location and action taken.' },
  { kind: 'grades', label: 'Grades', about: 'Published report-card lines per student, course and period; filter by school year.' },
];

export const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

/** The sign-in page asks who hosts it: a subdomain label (district.smartschool.example) or the API's default tenant. */
export function fetchBranding(): Promise<PublicBranding> {
  let slug = '';
  if (typeof window !== 'undefined') {
    const parts = window.location.hostname.split('.');
    if (parts.length > 2 && !['www', 'app', 'api'].includes(parts[0])) slug = parts[0];
  }
  return api<PublicBranding>(slug ? `/branding?tenant=${encodeURIComponent(slug)}` : '/branding', { auth: false });
}
