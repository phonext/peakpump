import { RouteNotFound } from "@/components/boundary/RouteNotFound";

export default function CreateNotFound() {
  return (
    <RouteNotFound
      title="That page does not exist"
      detail="Creation lives at /create, and this address is not it."
    />
  );
}
