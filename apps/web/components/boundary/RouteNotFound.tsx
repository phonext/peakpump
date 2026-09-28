import { EmptyState } from "@peakpump/ui/EmptyState";
import Link from "next/link";

export interface RouteNotFoundProps {
  title: string;
  detail: string;
}

// A server component: a not-found page has nothing to do but say so and offer the one
// route that always exists.
export function RouteNotFound({ title, detail }: RouteNotFoundProps) {
  return (
    <EmptyState
      title={title}
      detail={detail}
      action={
        <Link
          href="/"
          className="pp-press pp-lift hairline inline-flex min-h-[44px] min-w-[44px] items-center rounded-pp px-4 text-body text-pp-text outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
        >
          Markets
        </Link>
      }
    />
  );
}
