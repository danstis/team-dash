import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { useCredentials } from "../../app/credentials-context";
import { maskedIdentifierFor } from "./helpers";

export type StorageMode = "session" | "persistent";

export interface StorageModeSelectorProps {
  readonly token: string;
  readonly maskedIdentifier?: string;
  readonly onModeSelected?: (mode: StorageMode) => void;
}

function displayIdentifier(identifier: string): string {
  if (identifier.length === 0) {
    return "";
  }
  if (identifier === "••••") {
    return identifier;
  }
  return `…${identifier}`;
}

interface PersistentStorageDialogProps {
  readonly onConfirm: () => void;
  readonly onDecline: () => void;
  readonly confirmButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly declineButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => void;
}

function PersistentStorageDialog({
  onConfirm,
  onDecline,
  confirmButtonRef,
  declineButtonRef,
  onKeyDown,
}: Readonly<PersistentStorageDialogProps>): ReactElement {
  return (
    <form
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="persistent-storage-title"
      aria-describedby="persistent-storage-disclosure"
      data-testid="persistent-confirmation"
      onKeyDown={onKeyDown}
    >
      <h3 id="persistent-storage-title">Confirm persistent storage</h3>
      <div id="persistent-storage-disclosure">
        <p>
          Your Asana personal access token is sensitive. Anyone who obtains it
          may access the Asana data allowed by that token.
        </p>
        <p>
          The token is encrypted at rest with AES-GCM and a non-extractable key.
          This reduces opportunistic access to copied browser storage, but it
          cannot protect the token from an attacker who can execute scripts in
          this application&apos;s origin.
        </p>
        <p>
          The stored token remains on this device and in this browser profile
          until you switch to session-only storage or clear local data.
        </p>
      </div>
      <button ref={confirmButtonRef} type="button" onClick={onConfirm}>
        Confirm persistent storage
      </button>
      <button ref={declineButtonRef} type="button" onClick={onDecline}>
        Decline
      </button>
    </form>
  );
}

export function StorageModeSelector({
  token,
  maskedIdentifier = "",
  onModeSelected,
}: Readonly<StorageModeSelectorProps>): ReactElement {
  const credentials = useCredentials();
  const [selectedMode, setSelectedMode] = useState<StorageMode | null>(
    credentials.mode,
  );
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const sessionRadioRef = useRef<HTMLInputElement>(null);
  const persistentRadioRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const declineButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const identifier = maskedIdentifierFor(
    token.length > 0 ? token : maskedIdentifier,
  );

  useEffect(() => {
    setSelectedMode(credentials.mode);
    setConfirmationOpen(false);
  }, [credentials.mode, maskedIdentifier, token]);

  useEffect(() => {
    if (!confirmationOpen) {
      return;
    }
    confirmButtonRef.current?.focus();
  }, [confirmationOpen]);

  const selectSession = useCallback(async (): Promise<void> => {
    if (token.length === 0 || pending) {
      return;
    }
    setPending(true);
    try {
      await credentials.setSessionToken(token, identifier);
      setSelectedMode("session");
      setConfirmationOpen(false);
      onModeSelected?.("session");
    } finally {
      setPending(false);
    }
  }, [credentials, identifier, onModeSelected, pending, token]);

  const requestPersistent = useCallback((): void => {
    if (token.length === 0 || pending) {
      return;
    }
    previousFocusRef.current = persistentRadioRef.current;
    setSelectedMode("persistent");
    setConfirmationOpen(true);
  }, [pending, token]);

  const restoreTriggerFocus = useCallback((): void => {
    setTimeout(() => {
      previousFocusRef.current?.focus();
    }, 0);
  }, []);

  const confirmPersistent = useCallback(async (): Promise<void> => {
    if (token.length === 0 || pending) {
      return;
    }
    setPending(true);
    try {
      await credentials.setPersistentToken(token, identifier);
      setSelectedMode("persistent");
      setConfirmationOpen(false);
      onModeSelected?.("persistent");
      restoreTriggerFocus();
    } finally {
      setPending(false);
    }
  }, [
    credentials,
    identifier,
    onModeSelected,
    pending,
    restoreTriggerFocus,
    token,
  ]);

  const declinePersistent = useCallback(async (): Promise<void> => {
    await selectSession();
    restoreTriggerFocus();
  }, [restoreTriggerFocus, selectSession]);

  const onDialogKeyDown = useCallback(
    (event: KeyboardEvent<HTMLFormElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        void declinePersistent();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusableButtons = [
        confirmButtonRef.current,
        declineButtonRef.current,
      ].filter((value): value is HTMLButtonElement => value !== null);
      if (focusableButtons.length === 0) {
        return;
      }
      event.preventDefault();
      const activeIndex = focusableButtons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      let nextIndex = 0;
      if (activeIndex === -1) {
        nextIndex = event.shiftKey ? focusableButtons.length - 1 : 0;
      } else {
        const delta = event.shiftKey ? -1 : 1;
        nextIndex =
          (activeIndex + delta + focusableButtons.length) %
          focusableButtons.length;
      }
      focusableButtons[nextIndex]?.focus();
    },
    [declinePersistent],
  );

  return (
    <fieldset
      className="td-storage-mode-selector"
      data-testid="storage-mode-selector"
      disabled={pending || token.length === 0}
    >
      <legend>Token storage</legend>
      <p>
        Token identifier: <code>{displayIdentifier(identifier)}</code>. Only the
        last four characters are shown.
      </p>
      <label>
        <input
          ref={sessionRadioRef}
          type="radio"
          name="storage-mode"
          value="session"
          checked={selectedMode === "session"}
          onChange={() => {
            void selectSession();
          }}
        />{" "}
        Session-only
      </label>
      <p>
        Keeps the token in memory for the current session and requires it again
        next time.
      </p>
      <label>
        <input
          ref={persistentRadioRef}
          type="radio"
          name="storage-mode"
          value="persistent"
          checked={selectedMode === "persistent"}
          onChange={requestPersistent}
        />{" "}
        Persistent
      </label>
      <p>
        Stores the token locally only after you review and confirm the risks.
      </p>

      {confirmationOpen && (
        <PersistentStorageDialog
          onConfirm={() => void confirmPersistent()}
          onDecline={() => void declinePersistent()}
          confirmButtonRef={confirmButtonRef}
          declineButtonRef={declineButtonRef}
          onKeyDown={onDialogKeyDown}
        />
      )}
    </fieldset>
  );
}
