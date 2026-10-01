import { decideEnrollment, seatsAvailable } from './enrollment-rules';

describe('enrolment rules', () => {
  it('skips students already on the roster or waitlist', () => {
    expect(
      decideEnrollment({
        existingStatus: 'ENROLLED',
        enrolledCount: 0,
        maxStudents: 10,
      }),
    ).toBe('skipped');
    expect(
      decideEnrollment({
        existingStatus: 'WAITLISTED',
        enrolledCount: 0,
        maxStudents: 10,
      }),
    ).toBe('skipped');
  });

  it('enrols while seats remain, otherwise waitlists', () => {
    expect(
      decideEnrollment({
        existingStatus: null,
        enrolledCount: 9,
        maxStudents: 10,
      }),
    ).toBe('enrolled');
    expect(
      decideEnrollment({
        existingStatus: null,
        enrolledCount: 10,
        maxStudents: 10,
      }),
    ).toBe('waitlisted');
    expect(
      decideEnrollment({
        existingStatus: 'DROPPED',
        enrolledCount: 10,
        maxStudents: 10,
      }),
    ).toBe('waitlisted');
    expect(
      decideEnrollment({
        existingStatus: 'COMPLETED',
        enrolledCount: 0,
        maxStudents: null,
      }),
    ).toBe('enrolled');
  });

  it('reports free seats', () => {
    expect(seatsAvailable(3, 5)).toBe(2);
    expect(seatsAvailable(7, 5)).toBe(0);
    expect(seatsAvailable(7, null)).toBe(Number.POSITIVE_INFINITY);
  });
});
