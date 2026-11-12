import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Class names, merged so later Tailwind utilities win. */
export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
