import type { Grade } from '@/lib/api/types';

/** Grades are always shown with their system: conversion between systems is never implied. */
export function Grades({ grades, emptyLabel }: { grades: Grade[]; emptyLabel: string }) {
  if (grades.length === 0) return <span className="grade-none">{emptyLabel}</span>;
  return (
    <span className="grades">
      {grades.map((g) => (
        <span key={g.system} className="grade" title={g.system}>
          <span className="sys">{g.system}</span>
          <span className="val">{g.value}</span>
        </span>
      ))}
    </span>
  );
}

/** Short label for list badges: the first grade with its system, e.g. "RU 5Б". */
export function primaryGrade(grades: Grade[]): string | null {
  const g = grades[0];
  return g ? `${g.system} ${g.value}` : null;
}
