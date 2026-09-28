import type { Metadata } from "next";
import { CreateFlow } from "@/components/create/CreateFlow";

export const metadata: Metadata = { title: "Create" };

// A server component that owns nothing: the flow is a reducer in the browser,
// and every number it charges against is a live contract read there.
export default function CreatePage() {
  return <CreateFlow />;
}
