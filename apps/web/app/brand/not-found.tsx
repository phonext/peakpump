import { RouteNotFound } from "@/components/boundary/RouteNotFound";

export default function BrandNotFound() {
  return (
    <RouteNotFound
      title="That page does not exist"
      detail="Brand and attribution content lives at /brand."
    />
  );
}
