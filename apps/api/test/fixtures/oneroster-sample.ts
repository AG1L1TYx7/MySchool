import { zipSync } from 'fflate';

/** A small OneRoster 1.1 CSV bundle: one school, two terms, a teacher, two students, a parent, a course, a class. */
export const SAMPLE_BUNDLE = {
  'orgs.csv':
    'sourcedId,status,dateLastModified,name,type,identifier,parentSourcedId\norg1,active,,Lincoln Middle School,school,LMS,dist1\ndist1,active,,Springfield USD,district,,\n',
  'academicSessions.csv':
    'sourcedId,status,dateLastModified,title,type,startDate,endDate,parentSourcedId,schoolYear\nsy26,active,,2026-2027,schoolYear,2026-08-15,2027-06-05,,2027\nfall26,active,,Fall 2026,semester,2026-08-15,2026-12-20,sy26,2027\n',
  'users.csv':
    'sourcedId,status,dateLastModified,enabledUser,orgSourcedIds,role,username,userIds,givenName,familyName,middleName,identifier,email,sms,phone,agentSourcedIds,grades,password\nt1,active,,true,org1,teacher,jlee,,Jordan,Lee,,T100,jordan.lee@lincoln.example.org,,,,,\ns1,active,,true,org1,student,asmith,,Avery,Smith,,S2001,avery.smith@students.example.org,,,,"07",\ns2,active,,true,org1,student,bjones,,Blake,Jones,,S2002,,,,,"07",\np1,active,,true,org1,parent,csmith,,Casey,Smith,,,casey.smith@example.com,,,"s1,s2",,\nx1,active,,true,org1,proctor,proc,,Pat,Proctor,,,pat@example.org,,,,,\n',
  'courses.csv':
    'sourcedId,status,dateLastModified,schoolYearSourcedId,title,courseCode,grades,orgSourcedId,subjects,subjectCodes\nc1,active,,sy26,Math 7,MATH7,"07",org1,Mathematics,\n',
  'classes.csv':
    'sourcedId,status,dateLastModified,title,grades,courseSourcedId,classCode,classType,location,schoolSourcedId,termSourcedIds,subjects,subjectCodes,periods\nk1,active,,Math 7 - Period 3,"07",c1,MATH7-3,scheduled,Room 12,org1,fall26,Mathematics,,"3"\n',
  'enrollments.csv':
    'sourcedId,status,dateLastModified,classSourcedId,schoolSourcedId,userSourcedId,role,primary,beginDate,endDate\ne1,active,,k1,org1,t1,teacher,true,,\ne2,active,,k1,org1,s1,student,,,\ne3,active,,k1,org1,s2,student,,,\n',
  'demographics.csv':
    'sourcedId,status,dateLastModified,birthDate,sex\ns1,active,,2013-04-02,\n',
};

export function sampleZip(): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(SAMPLE_BUNDLE).map(([k, v]) => [
        k,
        new TextEncoder().encode(v),
      ]),
    ),
  );
}
