import { RouteNotFound } from "@/components/boundary/RouteNotFound";

export default function NotFound() {
  return (
    <RouteNotFound
      title="That page does not exist"
      detail="The product has six pages, and this address is not one of them."
    />
  );
}
