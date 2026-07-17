import * as React from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import type { AdminUserRecord, UsersListResponse } from './types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ScrollArea } from './ui/scroll-area';
import { formatNumber, truncateAddress } from './format';
import { cn } from './lib/utils';

const SEARCH_DEBOUNCE_MS = 250;

export type AdminUserChoice = Pick<AdminUserRecord, 'id' | 'name' | 'walletAddress'>;

export function toggleAdminUserSelection(
  selectedUsers: readonly AdminUserChoice[],
  user: AdminUserChoice
): AdminUserChoice[] {
  return selectedUsers.some((selected) => selected.id === user.id)
    ? selectedUsers.filter((selected) => selected.id !== user.id)
    : [...selectedUsers, user];
}

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

function toUserChoice(user: AdminUserRecord): AdminUserChoice {
  return {
    id: user.id,
    name: user.name,
    walletAddress: user.walletAddress,
  };
}

interface AdminUserPickerProps {
  selectedUsers: readonly AdminUserChoice[];
  onSelectedUsersChange: (users: AdminUserChoice[]) => void;
  users: UsersListResponse | null;
  loading: boolean;
  error: string | null;
  loadUsers: (options?: { page?: number; query?: string }) => Promise<void>;
  disabled?: boolean;
}

export function AdminUserPicker({
  selectedUsers,
  onSelectedUsersChange,
  users,
  loading,
  error,
  loadUsers,
  disabled = false,
}: AdminUserPickerProps) {
  const pickerId = React.useId();
  const searchInputId = `${pickerId}-player-search`;
  const resultsId = `${pickerId}-player-results`;
  const [query, setQuery] = React.useState('');
  const normalizedQuery = query.trim();
  const selectedIds = React.useMemo(
    () => new Set(selectedUsers.map((user) => user.id)),
    [selectedUsers]
  );
  const resultsAreCurrent = users?.query === normalizedQuery;
  const visibleUsers = resultsAreCurrent ? users.users : [];
  const pagination = resultsAreCurrent ? users.pagination : null;

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers({ page: 1, query: normalizedQuery });
    }, normalizedQuery ? SEARCH_DEBOUNCE_MS : 0);

    return () => window.clearTimeout(timer);
  }, [loadUsers, normalizedQuery]);

  const toggleUser = (user: AdminUserRecord) => {
    onSelectedUsersChange(toggleAdminUserSelection(selectedUsers, toUserChoice(user)));
  };

  const removeUser = (userId: string) => {
    onSelectedUsersChange(selectedUsers.filter((user) => user.id !== userId));
  };

  const goToPage = (page: number) => {
    void loadUsers({ page, query: normalizedQuery });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={searchInputId}>Recipients</Label>
        <div className="flex items-center gap-2">
          {selectedUsers.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onSelectedUsersChange([])}
              className="h-7 px-2 text-[11px]"
            >
              Clear
            </Button>
          ) : null}
          <Badge variant={selectedUsers.length > 0 ? 'info' : 'outline'}>
            {formatNumber(selectedUsers.length)} Selected
          </Badge>
        </div>
      </div>

      {selectedUsers.length > 0 ? (
        <div
          className="flex max-h-24 flex-wrap gap-2 overflow-y-auto rounded-lg border border-accent-secondary/20 bg-accent-secondary/[0.04] p-2"
          aria-label="Selected recipients"
        >
          {selectedUsers.map((user) => (
            <span
              key={user.id}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-accent-secondary/25 bg-accent-secondary/10 pl-2.5 pr-1 text-xs text-white/85"
            >
              <span className="max-w-40 truncate">{user.name}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeUser(user.id)}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-white/45 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-secondary disabled:pointer-events-none disabled:opacity-50"
                aria-label={`Remove ${user.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-strike-border-light bg-strike-canvas/30 px-3 py-2 text-xs text-white/40">
          No recipients selected. Choose one or more players below.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-strike-border-light bg-strike-canvas/50">
        <div className="border-b border-strike-border px-3 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <Input
              id={searchInputId}
              value={query}
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search players by name or wallet…"
              autoComplete="off"
              className="pl-9 pr-9"
              aria-controls={resultsId}
            />
            {loading ? (
              <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/40" />
            ) : query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-secondary"
                aria-label="Clear player search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-strike-border px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">
            {normalizedQuery ? 'Search results' : 'Recent players'}
          </span>
          {pagination ? (
            <span className="text-[11px] text-white/30">
              {formatNumber(pagination.total)} {pagination.total === 1 ? 'match' : 'matches'}
            </span>
          ) : null}
        </div>

        <ScrollArea className="h-56">
          <div id={resultsId} aria-label="Player results" className="p-1.5">
            {error && !loading ? (
              <div className="m-1 rounded-md border border-ui-danger/25 bg-ui-danger/[0.06] px-3 py-4 text-center text-xs text-ui-danger">
                {error}
              </div>
            ) : loading && !resultsAreCurrent ? (
              <div className="flex h-48 items-center justify-center gap-2 text-xs text-white/40">
                <Loader2 className="h-4 w-4 animate-spin" />
                Finding players…
              </div>
            ) : visibleUsers.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 px-4 text-center">
                <UserRound className="h-5 w-5 text-white/25" />
                <p className="text-xs text-white/40">
                  {normalizedQuery ? 'No players match this search.' : 'No player accounts found.'}
                </p>
              </div>
            ) : (
              visibleUsers.map((user) => {
                const selected = selectedIds.has(user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => toggleUser(user)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-secondary',
                      selected
                        ? 'bg-accent-secondary/10 text-white'
                        : 'text-white/75 hover:bg-white/[0.05] hover:text-white',
                      'disabled:pointer-events-none disabled:opacity-50'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold',
                        selected
                          ? 'border-accent-secondary/40 bg-accent-secondary/15 text-accent-secondary'
                          : 'border-white/10 bg-white/[0.04] text-white/55'
                      )}
                    >
                      {userInitials(user.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{user.name}</span>
                      <span className="block truncate font-mono text-[10px] text-white/35">
                        {user.walletAddress
                          ? truncateAddress(user.walletAddress, 6, 5)
                          : 'No wallet'}
                        {' · '}
                        {truncateAddress(user.id, 5, 4)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                        selected
                          ? 'border-accent-secondary/50 bg-accent-secondary text-strike-bg'
                          : 'border-white/15 text-transparent'
                      )}
                      aria-hidden="true"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>

        {pagination && pagination.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-strike-border px-3 py-2">
            <span className="text-[11px] text-white/35">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={disabled || loading || !pagination.hasPrevious}
                onClick={() => goToPage(pagination.page - 1)}
                aria-label="Previous player results page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={disabled || loading || !pagination.hasNext}
                onClick={() => goToPage(pagination.page + 1)}
                aria-label="Next player results page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <p className="text-[11px] text-white/35">
        Search and select multiple players. Your selections stay in place while browsing results.
      </p>
    </div>
  );
}
