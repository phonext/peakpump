"use client";

import { formatAddress } from "@peakpump/shared/format";
import { Button } from "@peakpump/ui/Button";
import { Dialog } from "@peakpump/ui/Dialog";
import { EmptyState } from "@peakpump/ui/EmptyState";
import { Skeleton } from "@peakpump/ui/Skeleton";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";
import { SignInDialog } from "@/components/social/SignInDialog";
import { useSession } from "@/hooks/useSession";

// Flat comments on one market: no threading, no replies, at most 500
// characters, one per address per market per 30 seconds — the server enforces
// all of it, and this component shows the server's own sentences rather than
// predicting them. Posting is optimistic: the comment appears the moment it is
// sent and disappears with the reason if the server refuses it.

interface CommentRow {
  id: string;
  address: string;
  body: string | null;
  deleted: boolean;
  createdAt: string;
}

const PAGE_SIZE = 50;

// The box a comment card reserves while the list loads, from the markup in CommentBody:
// p-3 top and bottom is 24, the two gap-2 between the three rows are 16, the address
// row is min-h-[44px], one body line at text-body is 24 and the action row is another
// min-h-[44px]. Keep in step with that component's classes.
const COMMENT_MIN_HEIGHT = 152;

const REASONS = ["SPAM", "IMPERSONATION", "ABUSE", "OTHER"] as const;
type Reason = (typeof REASONS)[number];

// The words a reader picks from the fixed set of reasons, at the same step the
// chip row uses. A report is one row and no follow-up question, so a label per
// reason is the whole interface.
const REASON_LABEL: Record<Reason, string> = {
  SPAM: "Spam",
  IMPERSONATION: "Impersonation",
  ABUSE: "Abuse",
  OTHER: "Other",
};

async function fetchComments(curve: Address, before?: string): Promise<CommentRow[]> {
  const url =
    before === undefined
      ? `/api/markets/${curve}/comments`
      : `/api/markets/${curve}/comments?before=${encodeURIComponent(before)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("The comment list did not load.");
  return ((await response.json()) as { comments: CommentRow[] }).comments;
}

function ageOf(iso: string): string {
  const seconds = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

// One report per reporter per target, so a repeat is the same report and
// the server answers 200 rather than an error. The user just sees it accepted.
function reportComment(commentId: string, reason: Reason): Promise<void> {
  return fetch("/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetType: "COMMENT", targetId: commentId, reason }),
  }).then((response) => {
    if (!response.ok) throw new Error("The report was not recorded. Try again.");
  });
}

function CommentBody({ comment, own, onReport, onDelete }: {
  comment: CommentRow;
  own: boolean;
  onReport: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="hairline rounded-pp bg-pp-surface flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* A wallet address is the only name a commenter has, and it links to
            the one page that aggregates an address. The 44px box is the target
            floor; the address keeps its baseline beside the age either way. */}
        <Link
          href={`/profile/${comment.address}`}
          className="mono text-small text-pp-text underline-offset-2 hover:underline inline-flex min-h-[44px] items-center"
        >
          {formatAddress(comment.address)}
        </Link>
        {/* text-body on mobile: an age is a number, and DESIGN.md floors
            numbers at the scale's third step there. */}
        <span className="mono text-body text-pp-text-faint md:text-small">{ageOf(comment.createdAt)}</span>
      </div>
      {comment.deleted ? (
        <p className="text-small text-pp-text-faint">Deleted by its author.</p>
      ) : (
        <p className="text-body text-pp-text whitespace-pre-wrap break-words">{comment.body}</p>
      )}
      <div className="flex items-center gap-2">
        {!comment.deleted ? (
          <Button size="sm" variant="ghost" onClick={onReport}>
            Report
          </Button>
        ) : null}
        {own && !comment.deleted ? (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function Comments({ curve }: { curve: Address }) {
  const { address: viewer, pending } = useSession();
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [reporting, setReporting] = useState<CommentRow | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);

  const list = useInfiniteQuery({
    queryKey: ["comments", curve],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchComments(curve, pageParam),
    // The route caches its answer for a minute at the CDN; matching that here
    // means a new comment lands within the minute without a refetch per focus.
    staleTime: 60_000,
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage[lastPage.length - 1]?.id : undefined,
  });

  const comments = list.data?.pages.flat() ?? [];

  const post = useMutation({
    mutationFn: (text: string) =>
      fetch(`/api/markets/${curve}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      }).then(async (response) => {
        if (!response.ok) {
          const error = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(error.error ?? "The comment was not posted.");
        }
        return ((await response.json()) as { comment: CommentRow }).comment;
      }),
    // Optimistic: the reader sees their words at once, and a refusal rolls the
    // list back to what the server last said was true.
    onMutate: async (text) => {
      await client.cancelQueries({ queryKey: ["comments", curve] });
      const previous = client.getQueryData(["comments", curve]);
      client.setQueryData(["comments", curve], (old: { pages: CommentRow[][] } | undefined) => {
        if (old === undefined) return old;
        return {
          ...old,
          pages: old.pages.map((page, index) =>
            index === 0
              ? [
                  {
                    id: `optimistic-${Date.now()}`,
                    address: viewer ?? "",
                    body: text,
                    deleted: false,
                    createdAt: new Date().toISOString(),
                  },
                  ...page,
                ]
              : page,
          ),
        };
      });
      return { previous };
    },
    onError: (error, _text, context) => {
      if (context?.previous !== undefined) client.setQueryData(["comments", curve], context.previous);
      setNotice(error.message);
    },
    onSuccess: (row, _text, context) => {
      // The server's row replaces the optimistic one, so the id that later
      // deletes or reports it is the real one.
      client.setQueryData(["comments", curve], (old: { pages: CommentRow[][] } | undefined) => {
        if (old === undefined) return old;
        return {
          ...old,
          pages: old.pages.map((page, index) =>
            index === 0
              ? [row, ...page.filter((comment) => !comment.id.startsWith("optimistic-"))]
              : page,
          ),
        };
      });
      if (context?.previous !== undefined) setNotice(null);
    },
  });

  const remove = useMutation({
    mutationFn: (commentId: string) =>
      fetch(`/api/comments/${commentId}`, { method: "DELETE" }).then((response) => {
        if (!response.ok) throw new Error("The comment was not deleted.");
      }),
    onMutate: async (commentId) => {
      await client.cancelQueries({ queryKey: ["comments", curve] });
      const previous = client.getQueryData(["comments", curve]);
      client.setQueryData(["comments", curve], (old: { pages: CommentRow[][] } | undefined) => {
        if (old === undefined) return old;
        return {
          ...old,
          pages: old.pages.map((page) =>
            page.map((comment) =>
              comment.id === commentId
                ? { ...comment, deleted: true, body: null }
                : comment,
            ),
          ),
        };
      });
      return { previous };
    },
    onError: (error, _commentId, context) => {
      if (context?.previous !== undefined) client.setQueryData(["comments", curve], context.previous);
      setNotice(error.message);
    },
  });

  const report = useMutation({
    mutationFn: () => (reporting === null || reason === null ? Promise.reject() : reportComment(reporting.id, reason)),
    onSuccess: () => {
      setReporting(null);
      setReason(null);
      setNotice("Reported. One report per account per target is kept.");
    },
    onError: () => {
      setNotice("The report was not recorded. Try again.");
    },
  });

  const canSubmit = body.trim().length > 0 && !post.isPending;

  return (
    <div className="flex flex-col gap-4">
      {viewer === null && !pending ? (
        <div className="flex flex-col gap-3">
          <p className="text-small text-pp-text-muted">
            Sign in to comment. Reading and trading never need a session.
          </p>
          <div>
            <Button size="sm" onClick={() => setSignInOpen(true)}>
              Sign in
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            post.mutate(body.trim());
            setBody("");
          }}
        >
          <label className="text-small text-pp-text-muted" htmlFor="comment-body">
            Comment
          </label>
          <textarea
            id="comment-body"
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, 500))}
            rows={3}
            // The server counts codepoints and the browser UTF-16 units, so a
            // comment heavy in combined glyphs can read 500 here and still be
            // refused there. The server is the authority; this is early feedback.
            className="mono hairline rounded-pp bg-pp-surface-2 text-body text-pp-text p-3 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
            placeholder="Say something about this market"
          />
          <div className="flex items-center justify-between gap-2">
            {/* Same number floor as the counter on the create form's name
                field: a figure, so Body on mobile and Small from md up. */}
            <span className="mono text-body text-pp-text-faint md:text-small">{body.length}/500</span>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {post.isPending ? "Posting" : "Post"}
            </Button>
          </div>
        </form>
      )}

      {notice !== null ? <p className="text-small text-pp-down" role="status">{notice}</p> : null}

      {list.isPending ? (
        <div className="flex flex-col gap-2">
          {/* A comment card's own minimum, measured from CommentBody rather than
              chosen: p-3 is 24, the two gap-2 are 16, the address row is min-h-[44px],
              one body line at text-body is 24 and the action row is another
              min-h-[44px], so 152. A body longer than one line grows past it, but a
              box below the minimum is a panel that grows on arrival, which is the
              shift DESIGN.md:256 says a skeleton exists to prevent. */}
          {[0, 1, 2].map((slot) => (
            <Skeleton key={slot} width="100%" height={COMMENT_MIN_HEIGHT} />
          ))}
        </div>
      ) : null}

      {list.isError ? (
        <EmptyState
          title="Comments did not load"
          detail="The list is served by the database. Try again in a moment."
        />
      ) : null}

      {!list.isPending && !list.isError && comments.length === 0 ? (
        <EmptyState
          title="No comments yet"
          detail="The first comment on this market has not been written. Comments are flat and cost no fee."
        />
      ) : null}

      <ul className="flex flex-col gap-2">
        {comments.map((comment) => (
          <li key={comment.id}>
            <CommentBody
              comment={comment}
              own={viewer !== null && comment.address.toLowerCase() === viewer.toLowerCase()}
              onReport={() => setReporting(comment)}
              onDelete={() => remove.mutate(comment.id)}
            />
          </li>
        ))}
      </ul>

      {list.hasNextPage ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => void list.fetchNextPage()}>
            {list.isFetchingNextPage ? "Loading" : "Show earlier comments"}
          </Button>
        </div>
      ) : null}

      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />

      <Dialog
        open={reporting !== null}
        onClose={() => {
          setReporting(null);
          setReason(null);
        }}
        title="Report this comment"
        description="One report per account is kept. Reports are read by a direct database query and nothing is automatic."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {REASONS.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={reason === value ? "primary" : "secondary"}
                onClick={() => setReason(value)}
              >
                {REASON_LABEL[value]}
              </Button>
            ))}
          </div>
          <div>
            <Button size="sm" disabled={reason === null || report.isPending} onClick={() => report.mutate()}>
              {report.isPending ? "Reporting" : "Report"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
