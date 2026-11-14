import type { ComponentChildren } from 'preact';
import { formatMoney } from '../game/hudState';
import { Icon, type IconName } from './icons';

/** Shared frame for the operations panels: title bar with icon, account balance and close. */
export function Modal({
  icon,
  title,
  subtitle,
  money,
  onClose,
  closeLabel,
  testId,
  wide = false,
  children,
}: {
  icon: IconName;
  title: string;
  subtitle?: ComponentChildren;
  money: number;
  onClose: () => void;
  closeLabel: string;
  testId: string;
  wide?: boolean;
  children: ComponentChildren;
}) {
  return (
    // Pointer-down, not click: a drag that starts on a slider and ends outside must not close it.
    <div class="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`panel modal${wide ? ' wide' : ''}`} data-testid={testId} role="dialog" aria-label={title}>
        <header class="modal-head">
          <span class="modal-icon">
            <Icon name={icon} size={22} />
          </span>
          <div class="modal-titles">
            <div class="modal-title">{title}</div>
            {subtitle && <div class="modal-sub">{subtitle}</div>}
          </div>
          <div class="account">
            <span class="account-label">Account</span>
            <span class="account-value" data-testid={`${testId}-money`}>
              {formatMoney(money)}
            </span>
          </div>
          <button class="icon-button" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div class="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Result line under a panel: green when an action worked, red with the reason when it did not. */
export function ResultLine({
  message,
  testId,
}: {
  message: { text: string; ok: boolean } | null;
  testId?: string;
}) {
  if (!message) return null;
  return (
    <div class={`result ${message.ok ? 'ok' : 'bad'}`} role="status" data-testid={testId}>
      {message.text}
    </div>
  );
}

/** Section heading with a ruled line, as on a printed operations sheet. */
export function SectionHead({ children, aside }: { children: ComponentChildren; aside?: ComponentChildren }) {
  return (
    <div class="section-head">
      <h2>{children}</h2>
      <span class="section-rule" />
      {aside}
    </div>
  );
}
