import { v7 as uuidv7 } from 'uuid';

/** Time-ordered UUID v7 for every primary key (ADR-020). */
export function newId(): string {
  return uuidv7();
}
