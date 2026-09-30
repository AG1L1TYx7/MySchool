'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui';
import { StudentForm, payloadFrom, valuesFrom } from '@/components/student-form';
import { api } from '@/lib/api';
import type { Student } from '@/lib/students';

export default function NewStudentPage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">New student</h1>
      <Card>
        <StudentForm
          mode="create"
          initial={valuesFrom()}
          submitLabel="Create student"
          onSubmit={async (values) => {
            const res = await api<{ student: Student }>('/students', { method: 'POST', body: payloadFrom(values, 'create') });
            router.replace(`/students/${res.student.id}`);
          }}
        />
      </Card>
    </div>
  );
}
