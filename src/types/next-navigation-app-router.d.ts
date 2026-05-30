import 'next/navigation';

declare module 'next/navigation' {
  export function usePathname(): string;
  export function useSearchParams(): URLSearchParams;
  export function useParams<
    T extends Record<string, string | string[]> = Record<string, string | string[]>,
  >(): T;
}
