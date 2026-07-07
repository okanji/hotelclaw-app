"use client";

import { notFound } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import {
  entitiesQueryOptions,
  entityTypesQueryOptions,
} from "@/lib/query/workflow-queries";
import { PageHeader } from "@/components/shell/page-header";
import { WorkflowsTabs } from "./workflows-tabs";
import { EntitiesClient } from "@/app/p/[propertyId]/workflows/entities/entities-client";
import { EntityTypeClient } from "@/app/p/[propertyId]/workflows/entities/[typeName]/entity-type-client";

export function WorkflowEntitiesList({ propertyId }: { propertyId: string }) {
  const { data: types } = useSuspenseQuery(entityTypesQueryOptions(propertyId));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
        ]}
      />
      <WorkflowsTabs propertyId={propertyId} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[820px] px-10 pt-10 pb-12">
          <EntitiesClient
            propertyId={propertyId}
            initialTypes={types as Parameters<typeof EntitiesClient>[0]["initialTypes"]}
          />
        </div>
      </div>
    </div>
  );
}

export function WorkflowEntityTypeView({
  propertyId,
  typeName,
}: {
  propertyId: string;
  typeName: string;
}) {
  const { data: types } = useSuspenseQuery(entityTypesQueryOptions(propertyId));
  const type = types.find((t) => t.name === typeName);
  if (!type) notFound();
  const { data: rows } = useSuspenseQuery(entitiesQueryOptions(propertyId, typeName));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
          { label: "Entities", href: `/p/${propertyId}/workflows/entities` },
          { label: type.display_name },
        ]}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[920px] px-10 pt-10 pb-12">
          <EntityTypeClient
            propertyId={propertyId}
            type={{
              id: type.id,
              name: type.name,
              display_name: type.display_name,
              schema: (type.schema ?? {}) as Record<string, unknown>,
            }}
            initialRows={rows as Parameters<typeof EntityTypeClient>[0]["initialRows"]}
          />
        </div>
      </div>
    </div>
  );
}
