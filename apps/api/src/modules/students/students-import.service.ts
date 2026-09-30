import { Injectable } from '@nestjs/common';
import { csvRecords } from '../../common/utils/csv';
import {
  isEnrollmentStatus,
  isLearningStyle,
  isRelationship,
  parseDate,
} from './students.mapper';
import type {
  EnrollmentStatusApi,
  LearningStyleApi,
  RelationshipApi,
} from './dto/students.dto';

/**
 * CSV parsing and validation for bulk student import. Pure: no database access, so it is
 * unit-tested exhaustively and StudentsService only has to persist what comes out.
 */

export interface ImportRow {
  line: number;
  studentNumber: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
  gradeLevel?: string;
  enrollmentStatus?: EnrollmentStatusApi;
  enrollmentDate?: Date;
  preferredLearningStyle?: LearningStyleApi;
  guardianEmail?: string;
  guardianFirstName?: string;
  guardianLastName?: string;
  guardianRelationship?: RelationshipApi;
}

export interface ImportError {
  line: number;
  message: string;
}

export interface ParsedImport {
  headers: string[];
  rows: ImportRow[];
  errors: ImportError[];
}

/** Accepted header spellings, normalised (lowercase, no spaces/underscores/dashes). */
const HEADER_ALIASES: Record<string, string[]> = {
  studentNumber: [
    'studentnumber',
    'studentid',
    'studentno',
    'number',
    'id',
    'sid',
  ],
  firstName: ['firstname', 'first', 'givenname', 'forename'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
  email: ['email', 'emailaddress', 'studentemail'],
  phone: ['phone', 'phonenumber', 'mobile', 'telephone'],
  dateOfBirth: ['dateofbirth', 'dob', 'birthdate', 'birthday'],
  gender: ['gender', 'sex'],
  gradeLevel: ['gradelevel', 'grade', 'year', 'yeargroup', 'class'],
  enrollmentStatus: ['enrollmentstatus', 'enrolmentstatus', 'status'],
  enrollmentDate: ['enrollmentdate', 'enrolmentdate', 'startdate', 'enrolled'],
  preferredLearningStyle: ['preferredlearningstyle', 'learningstyle'],
  guardianEmail: ['guardianemail', 'parentemail', 'guardian', 'parent'],
  guardianFirstName: ['guardianfirstname', 'parentfirstname'],
  guardianLastName: ['guardianlastname', 'parentlastname'],
  guardianRelationship: [
    'guardianrelationship',
    'relationship',
    'parentrelationship',
  ],
};

export const IMPORT_TEMPLATE_HEADERS = [
  'studentNumber',
  'firstName',
  'lastName',
  'email',
  'phone',
  'dateOfBirth',
  'gender',
  'gradeLevel',
  'enrollmentStatus',
  'enrollmentDate',
  'preferredLearningStyle',
  'guardianEmail',
  'guardianFirstName',
  'guardianLastName',
  'guardianRelationship',
] as const;

export const MAX_IMPORT_ROWS = 5000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class StudentsImportService {
  parse(csv: string): ParsedImport {
    const { headers, rows } = csvRecords(csv);
    const errors: ImportError[] = [];
    const map = resolveHeaders(headers);
    const missing = ['studentNumber', 'firstName', 'lastName'].filter(
      (k) => !map[k],
    );
    if (rows.length === 0 || missing.length) {
      errors.push({
        line: 1,
        message:
          rows.length === 0 && headers.length === 0
            ? 'The file is empty.'
            : `Missing required column(s): ${missing.join(', ')}.`,
      });
      return { headers, rows: [], errors };
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      errors.push({
        line: 1,
        message: `Too many rows: ${rows.length}. The limit is ${MAX_IMPORT_ROWS} per file.`,
      });
      return { headers, rows: [], errors };
    }

    const out: ImportRow[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const get = (key: string) => (map[key] ? (r.values[map[key]] ?? '') : '');
      const problems: string[] = [];
      const studentNumber = get('studentNumber');
      const firstName = get('firstName');
      const lastName = get('lastName');
      if (!studentNumber) problems.push('studentNumber is required');
      else if (!/^[A-Za-z0-9._/-]{1,50}$/.test(studentNumber))
        problems.push('studentNumber has invalid characters');
      else if (seen.has(studentNumber.toLowerCase()))
        problems.push(
          `studentNumber '${studentNumber}' appears more than once in the file`,
        );
      if (studentNumber) seen.add(studentNumber.toLowerCase());
      if (!firstName) problems.push('firstName is required');
      if (!lastName) problems.push('lastName is required');
      if (firstName.length > 100 || lastName.length > 100)
        problems.push('names must be 100 characters or fewer');

      const email = get('email').toLowerCase() || undefined;
      if (email && !EMAIL.test(email))
        problems.push(`email '${email}' is not valid`);
      const guardianEmail = get('guardianEmail').toLowerCase() || undefined;
      if (guardianEmail && !EMAIL.test(guardianEmail))
        problems.push(`guardianEmail '${guardianEmail}' is not valid`);

      const dob = parseDate(get('dateOfBirth'));
      if (dob === null) problems.push('dateOfBirth must be YYYY-MM-DD');
      const enrolled = parseDate(get('enrollmentDate'));
      if (enrolled === null) problems.push('enrollmentDate must be YYYY-MM-DD');

      const statusRaw = get('enrollmentStatus').toLowerCase();
      if (statusRaw && !isEnrollmentStatus(statusRaw))
        problems.push(
          `enrollmentStatus '${statusRaw}' is not one of active, inactive, graduated, transferred, withdrawn, suspended`,
        );
      const styleRaw = get('preferredLearningStyle')
        .toLowerCase()
        .replace(/[\s/-]+/g, '_');
      if (styleRaw && !isLearningStyle(styleRaw))
        problems.push(`preferredLearningStyle '${styleRaw}' is not recognised`);
      const relRaw = get('guardianRelationship').toLowerCase();
      if (relRaw && !isRelationship(relRaw))
        problems.push(`guardianRelationship '${relRaw}' is not recognised`);
      const gradeLevel = normaliseGrade(get('gradeLevel'));
      if (gradeLevel && gradeLevel.length > 16)
        problems.push('gradeLevel is too long');

      if (problems.length) {
        errors.push({ line: r.line, message: problems.join('; ') });
        continue;
      }
      out.push({
        line: r.line,
        studentNumber,
        firstName,
        lastName,
        email,
        phone: get('phone') || undefined,
        dateOfBirth: dob ?? undefined,
        gender: get('gender') || undefined,
        gradeLevel: gradeLevel || undefined,
        enrollmentStatus:
          statusRaw && isEnrollmentStatus(statusRaw) ? statusRaw : undefined,
        enrollmentDate: enrolled ?? undefined,
        preferredLearningStyle:
          styleRaw && isLearningStyle(styleRaw) ? styleRaw : undefined,
        guardianEmail,
        guardianFirstName: get('guardianFirstName') || undefined,
        guardianLastName: get('guardianLastName') || undefined,
        guardianRelationship:
          relRaw && isRelationship(relRaw) ? relRaw : undefined,
      });
    }
    return { headers, rows: out, errors };
  }
}

function resolveHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const hit = headers.find((h) => aliases.includes(h));
    if (hit) map[key] = hit;
  }
  return map;
}

/** "Grade 7", "7th", "07", "K", "Kindergarten" -> "7", "7", "7", "K", "K". */
export function normaliseGrade(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  if (/^(k|kg|kindergarten)$/i.test(v)) return 'K';
  const m = /^(?:grade|year|g|y)?\s*0*(\d{1,2})(?:st|nd|rd|th)?$/i.exec(v);
  return m ? String(Number(m[1])) : v;
}
