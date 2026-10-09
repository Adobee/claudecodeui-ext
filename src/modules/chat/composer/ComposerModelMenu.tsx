import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { ProviderModelOption, ProviderModelsDefinition } from '@/shared/types';
import { DEFAULT_EFFORT_VALUE } from '@/shared/constants';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

type ComposerModelMenuProps = {
  effort: string;
  /** Effort values the active provider/model actually accepts; empty hides the section. */
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  /** Model catalog for the active provider; empty hides the section. */
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  onRefreshModels?: (force?: boolean) => Promise<void>;
  modelSync?: ProviderModelsDefinition['SYNC'];
};

/**
 * Rendered by chat's ChatComposer as the popover for choosing the active
 * provider's model and reasoning effort for the next turn.
 */
function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
  onSelectModel,
  modelsLoading,
  onRefreshModels,
  modelSync,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const [isModelSectionOpen, setIsModelSectionOpen] = useState(false);
  // Keep repeated mobile taps from submitting multiple forced refreshes.
  const [isSyncing, setIsSyncing] = useState(false);
  // Transport errors are distinct from a successful response containing stale metadata.
  const [syncFailed, setSyncFailed] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close);

  // The model list starts collapsed every time the menu opens, the way Codex
  // shows reasoning first and keeps the longer model list one click away.
  useEffect(() => {
    if (!isOpen) {
      setIsModelSectionOpen(false);
    }
  }, [isOpen]);

  const defaultEffortLabel = onRefreshModels
    ? t('composer.codexFollowConfig', { defaultValue: 'Follow Codex configuration' })
    : t('composer.effortDefault', { defaultValue: 'Default' });
  const resolvedEffortOptions = useMemo<EffortOption[]>(
    () => (effortOptions.length > 0 ? [{ value: DEFAULT_EFFORT_VALUE }, ...effortOptions] : []),
    [effortOptions],
  );
  const effortLabel = effort === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : effort;

  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.value === model) ?? null,
    [model, modelOptions],
  );
  const modelLabel = selectedModelOption?.label || model;

  const hasEffortSection = resolvedEffortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading;
  if (!hasEffortSection && !hasModelSection && !onRefreshModels) {
    return null;
  }

  const triggerLabel = hasModelSection ? modelLabel : effortLabel;
  const ariaLabel = t('composer.modelMenu', {
    defaultValue: 'Select model and reasoning effort',
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          if (!isOpen) void onRefreshModels?.().catch(() => setSyncFailed(true));
          setIsOpen((current) => !current);
        }}
        className="flex h-8 max-w-20 shrink-0 items-center gap-1 rounded-lg border border-border/60 bg-muted/40 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:max-w-56"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="truncate">{triggerLabel}</span>
        {hasModelSection && hasEffortSection && effort !== DEFAULT_EFFORT_VALUE && (
          <span className="hidden shrink-0 capitalize text-muted-foreground sm:inline">· {effortLabel}</span>
        )}
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          {onRefreshModels && (
            <>
              <div className="px-3 py-2 text-xs text-muted-foreground" role="status">
                {syncFailed || modelSync?.stale
                  ? t('composer.codexSyncStale', { defaultValue: 'Sync unavailable; using cached or fallback models.' })
                  : modelSync?.updatedAt
                    ? t('composer.codexSyncedAt', { defaultValue: 'Synced {{time}}', time: new Date(modelSync.updatedAt).toLocaleString() })
                    : t('composer.codexSyncPending', { defaultValue: 'Model discovery pending' })}
              </div>
              <button type="button" disabled={isSyncing} className="w-full px-3 py-2 text-left text-xs disabled:opacity-50"
                onClick={async () => {
                  setIsSyncing(true);
                  setSyncFailed(false);
                  try { await onRefreshModels(true); }
                  catch { setSyncFailed(true); }
                  finally { setIsSyncing(false); }
                }}>
                {isSyncing ? t('composer.codexSyncing', { defaultValue: 'Syncing…' }) : t('composer.codexSyncNow', { defaultValue: 'Sync models and reasoning levels' })}
              </button>
              {!selectedModelOption && <div className="px-3 py-2 text-xs text-amber-600">{t('composer.codexModelMissing', { defaultValue: 'Current model is not in this catalog; your selection is preserved.' })}</div>}
              {selectedModelOption?.effort?.default && <div className="px-3 py-2 text-xs text-muted-foreground">{t('composer.codexModelDefault', { defaultValue: 'Model default: {{effort}}. Follow configuration may use a local override.', effort: selectedModelOption.effort.default })}</div>}
              <ComposerMenuSeparator />
            </>
          )}
          {hasEffortSection && (
            <>
              <ComposerMenuHeading>
                {t('composer.reasoning', { defaultValue: 'Reasoning' })}
              </ComposerMenuHeading>
              {resolvedEffortOptions.map((option) => (
                <ComposerMenuItem
                  key={option.value}
                  label={option.value === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : option.value}
                  description={option.description}
                  isSelected={option.value === effort}
                  onSelect={() => {
                    onSelectEffort(option.value);
                    setIsOpen(false);
                  }}
                  className="capitalize"
                />
              ))}
            </>
          )}

          {hasModelSection && (
            <>
              {hasEffortSection && <ComposerMenuSeparator />}
              <ComposerMenuItem
                role="menuitem"
                label={modelLabel}
                isSelected={false}
                onSelect={() => setIsModelSectionOpen((current) => !current)}
                trailing={
                  isModelSectionOpen
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                }
                className="text-muted-foreground"
              />

              {isModelSectionOpen && (
                <>
                  <ComposerMenuHeading>
                    {t('composer.model', { defaultValue: 'Model' })}
                  </ComposerMenuHeading>
                  {modelOptions.length === 0 && modelsLoading && (
                    <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                      {t('composer.loadingModels', { defaultValue: 'Loading models…' })}
                    </p>
                  )}
                  {modelOptions.map((option) => (
                    <ComposerMenuItem
                      key={option.value}
                      label={option.label || option.value}
                      isSelected={option.value === model}
                      onSelect={() => {
                        onSelectModel(option.value);
                        setIsOpen(false);
                      }}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerModelMenu);
