import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  sendGlobalChatMessage,
  useGlobalChat,
  useGlobalChatStore,
  type GlobalChatMessage,
} from '../../social/globalChat';

interface GlobalChatProps {
  displayName: string;
}

function formatGlobalChatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();

  if (sameDay) return time;

  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

function GlobalChatLine({ message }: { message: GlobalChatMessage }) {
  const timestamp = formatGlobalChatTime(message.createdAt);

  return (
    <li className="global-chat-message">
      <time dateTime={message.createdAt} className="global-chat-message-time">
        {timestamp}
      </time>
      <span className="global-chat-message-name">{message.playerName}:</span>
      <span className="global-chat-message-text">{message.message}</span>
    </li>
  );
}

function shouldIgnoreGlobalChatFocusShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest(
    'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="tab"], [role="menuitem"]'
  ));
}

export function GlobalChat({ displayName }: GlobalChatProps) {
  useGlobalChat(displayName);

  const messages = useGlobalChatStore((state) => state.messages);
  const [draft, setDraft] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const visibleMessages = useMemo(() => messages.slice(isExpanded ? -7 : -1), [isExpanded, messages]);
  const lastVisibleMessageId = visibleMessages[visibleMessages.length - 1]?.id ?? null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [lastVisibleMessageId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter'
        || event.defaultPrevented
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || shouldIgnoreGlobalChatFocusShortcut(event.target)
      ) {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;

    if (sendGlobalChatMessage(message)) {
      setDraft('');
    }
  };

  return (
    <section
      className={`global-chat-panel ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}
      aria-label="Global chat"
      onFocusCapture={() => setIsExpanded(true)}
      onBlurCapture={(event) => {
        const nextFocusTarget = event.relatedTarget;
        if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) return;
        setIsExpanded(false);
      }}
    >
      <ol className="global-chat-messages" aria-live="polite">
        {visibleMessages.length > 0 ? (
          visibleMessages.map((message) => (
            <GlobalChatLine key={message.id} message={message} />
          ))
        ) : (
          <li className="global-chat-empty">No transmissions yet.</li>
        )}
        <div ref={messagesEndRef} />
      </ol>

      <form className="global-chat-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={220}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type to chat"
          aria-label="Send global chat message"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" aria-label="Send message" disabled={!draft.trim()}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </section>
  );
}
