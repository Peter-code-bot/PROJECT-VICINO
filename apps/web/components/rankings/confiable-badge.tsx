import { Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ConfiableBadge() {
  return (
    <Badge variant="success">
      <Shield className="h-3 w-3" aria-hidden />
      Confiable
    </Badge>
  );
}
