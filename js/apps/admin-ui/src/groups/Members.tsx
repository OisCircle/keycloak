import type GroupRepresentation from "@keycloak/keycloak-admin-client/lib/defs/groupRepresentation";
import type UserRepresentation from "@keycloak/keycloak-admin-client/lib/defs/userRepresentation";
import {
  AlertVariant,
  Button,
  Checkbox,
  Dropdown,
  DropdownItem,
  KebabToggle,
  ToolbarItem,
} from "@patternfly/react-core";
import { uniqBy } from "lodash-es";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { adminClient } from "../admin-client";
import { useAlerts } from "../components/alert/Alerts";
import { GroupPath } from "../components/group/GroupPath";
import { KeycloakSpinner } from "../components/keycloak-spinner/KeycloakSpinner";
import { ListEmptyState } from "../components/list-empty-state/ListEmptyState";
import {
  Action,
  KeycloakDataTable,
} from "../components/table-toolbar/KeycloakDataTable";
import { useAccess } from "../context/access/Access";
import { useRealm } from "../context/realm-context/RealmContext";
import { toUser } from "../user/routes/User";
import { emptyFormatter } from "../util";
import { useFetch } from "../utils/useFetch";
import { MemberModal } from "./MembersModal";
import { useSubGroups } from "./SubGroupsContext";
import { getLastId } from "./groupIdUtils";

type MembersOf = UserRepresentation & {
  membership: GroupRepresentation[];
};

const MemberOfRenderer = (member: MembersOf) => {
  return (
    <>
      {member.membership.map((group, index) => (
        <>
          <GroupPath key={group.id} group={group} />
          {member.membership[index + 1] ? ", " : ""}
        </>
      ))}
    </>
  );
};

const UserDetailLink = (user: MembersOf) => {
  const { realm } = useRealm();
  return (
    <Link key={user.id} to={toUser({ realm, id: user.id!, tab: "settings" })}>
      {user.username}
    </Link>
  );
};

export const Members = () => {
  const { t } = useTranslation();

  const { addAlert, addError } = useAlerts();
  const location = useLocation();
  const id = getLastId(location.pathname);
  const [includeSubGroup, setIncludeSubGroup] = useState(false);
  const { currentGroup: group } = useSubGroups();
  const [currentGroup, setCurrentGroup] = useState<GroupRepresentation>();
  const [addMembers, setAddMembers] = useState(false);
  const [isKebabOpen, setIsKebabOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<UserRepresentation[]>([]);
  const { hasAccess } = useAccess();

  useFetch(
    () => adminClient.groups.findOne({ id: group()!.id! }),
    setCurrentGroup,
    [],
  );

  const isManager =
    hasAccess("manage-users") || currentGroup?.access!.manageMembership;

  const [key, setKey] = useState(0);
  const refresh = () => setKey(new Date().getTime());

  const getMembership = async (id: string) =>
    await adminClient.users.listGroups({ id: id! });

  const getSubGroups = (groups: GroupRepresentation[]) => {
    let subGroups: GroupRepresentation[] = [];
    for (const group of groups!) {
      subGroups.push(group);
      const subs = getSubGroups(group.subGroups!);
      subGroups = subGroups.concat(subs);
    }
    return subGroups;
  };

  const loader = async (first?: number, max?: number) => {
    let members = await adminClient.groups.listMembers({
      id: id!,
      first,
      max,
    });

    if (includeSubGroup) {
      const subGroups = getSubGroups(currentGroup?.subGroups || []);
      for (const group of subGroups) {
        members = members.concat(
          await adminClient.groups.listMembers({ id: group.id! }),
        );
      }
      members = uniqBy(members, (member) => member.username);
    }

    const memberOfPromises = await Promise.all(
      members.map((member) => getMembership(member.id!)),
    );
    return members.map((member: UserRepresentation, i) => {
      return { ...member, membership: memberOfPromises[i] };
    });
  };

  if (!currentGroup) {
    return <KeycloakSpinner />;
  }

  return (
    <>
      {addMembers && (
        <MemberModal
          groupId={id!}
          onClose={() => {
            setAddMembers(false);
            refresh();
          }}
        />
      )}
      <KeycloakDataTable
        data-testid="members-table"
        key={`${id}${key}${includeSubGroup}`}
        loader={loader}
        ariaLabelKey="members"
        isPaginated
        canSelectAll
        onSelect={(rows) => setSelectedRows([...rows])}
        toolbarItem={
          isManager && (
            <>
              <ToolbarItem>
                <Button
                  data-testid="addMember"
                  variant="primary"
                  onClick={() => setAddMembers(true)}
                >
                  {t("addMember")}
                </Button>
              </ToolbarItem>
              <ToolbarItem>
                <Checkbox
                  data-testid="includeSubGroupsCheck"
                  label={t("includeSubGroups")}
                  id="kc-include-sub-groups"
                  isChecked={includeSubGroup}
                  onChange={() => setIncludeSubGroup(!includeSubGroup)}
                />
              </ToolbarItem>
              <ToolbarItem>
                <Dropdown
                  toggle={
                    <KebabToggle
                      onToggle={() => setIsKebabOpen(!isKebabOpen)}
                      isDisabled={selectedRows.length === 0}
                    />
                  }
                  isOpen={isKebabOpen}
                  isPlain
                  dropdownItems={[
                    <DropdownItem
                      key="action"
                      component="button"
                      onClick={async () => {
                        try {
                          await Promise.all(
                            selectedRows.map((user) =>
                              adminClient.users.delFromGroup({
                                id: user.id!,
                                groupId: id!,
                              }),
                            ),
                          );
                          setIsKebabOpen(false);
                          addAlert(
                            t("usersLeft", { count: selectedRows.length }),
                            AlertVariant.success,
                          );
                        } catch (error) {
                          addError("usersLeftError", error);
                        }

                        refresh();
                      }}
                    >
                      {t("leave")}
                    </DropdownItem>,
                  ]}
                />
              </ToolbarItem>
            </>
          )
        }
        actions={
          isManager
            ? [
                {
                  title: t("leave"),
                  onRowClick: async (user) => {
                    try {
                      await adminClient.users.delFromGroup({
                        id: user.id!,
                        groupId: id!,
                      });
                      addAlert(
                        t("usersLeft", { count: 1 }),
                        AlertVariant.success,
                      );
                    } catch (error) {
                      addError("usersLeftError", error);
                    }

                    return true;
                  },
                } as Action<UserRepresentation>,
              ]
            : []
        }
        columns={[
          {
            name: "username",
            displayKey: "name",
            cellRenderer: UserDetailLink,
          },
          {
            name: "email",
            displayKey: "email",
            cellFormatters: [emptyFormatter()],
          },
          {
            name: "firstName",
            displayKey: "firstName",
            cellFormatters: [emptyFormatter()],
          },
          {
            name: "lastName",
            displayKey: "lastName",
            cellFormatters: [emptyFormatter()],
          },
          {
            name: "membership",
            displayKey: "membership",
            cellRenderer: MemberOfRenderer,
          },
        ]}
        emptyState={
          <ListEmptyState
            message={t("users:noUsersFound")}
            instructions={isManager ? t("users:emptyInstructions") : undefined}
            primaryActionText={isManager ? t("addMember") : undefined}
            onPrimaryAction={() => setAddMembers(true)}
            secondaryActions={[
              {
                text: t("includeSubGroups"),
                onClick: () => setIncludeSubGroup(true),
              },
            ]}
          />
        }
      />
    </>
  );
};
