import { HomeSession } from "../home-session";
import { RankingSkeleton } from "@/components/home/ranking-skeleton";

/**
 * Sin semilla, HomeSession pinta lo que haya en memoria para esta pestaña y
 * zona (volver al inicio desde otra pestaña no espera al servidor) y solo un
 * esqueleto con forma de rejilla cuando no hay nada. La tira de rankings
 * llega con el render del servidor, asi que aqui va su hueco.
 */
export default function Loading() {
  return <HomeSession ranking={<RankingSkeleton />} />;
}
