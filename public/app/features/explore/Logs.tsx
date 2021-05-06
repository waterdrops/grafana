import React, { PureComponent } from 'react';
import { css } from '@emotion/css';
import { capitalize } from 'lodash';
import memoizeOne from 'memoize-one';

import {
  rangeUtil,
  RawTimeRange,
  LogLevel,
  TimeZone,
  AbsoluteTimeRange,
  LogsDedupStrategy,
  LogRowModel,
  LogsDedupDescription,
  LogsMetaItem,
  LogsSortOrder,
  GraphSeriesXY,
  LinkModel,
  Field,
  GrafanaTheme,
  DataQuery,
} from '@grafana/data';
import {
  RadioButtonGroup,
  LogRows,
  Button,
  InlineField,
  InlineFieldRow,
  InlineSwitch,
  withTheme,
  stylesFactory,
  CustomScrollbar,
} from '@grafana/ui';
import store from 'app/core/store';
import { dedupLogRows, filterLogLevels } from 'app/core/logs_model';
import { ExploreGraphPanel } from './ExploreGraphPanel';
import { LogsMetaRow } from './LogsMetaRow';
import LogsNavigation from './LogsNavigation';
import { RowContextOptions } from '@grafana/ui/src/components/Logs/LogRowContextProvider';

const SETTINGS_KEYS = {
  showLabels: 'grafana.explore.logs.showLabels',
  showTime: 'grafana.explore.logs.showTime',
  wrapLogMessage: 'grafana.explore.logs.wrapLogMessage',
};

interface Props {
  logRows: LogRowModel[];
  logsMeta?: LogsMetaItem[];
  logsSeries?: GraphSeriesXY[];
  visibleRange?: AbsoluteTimeRange;
  width: number;
  theme: GrafanaTheme;
  highlighterExpressions?: string[];
  loading: boolean;
  absoluteRange: AbsoluteTimeRange;
  timeZone: TimeZone;
  scanning?: boolean;
  scanRange?: RawTimeRange;
  queries: DataQuery[];
  showContextToggle?: (row?: LogRowModel) => boolean;
  onChangeTime: (range: AbsoluteTimeRange) => void;
  onClickFilterLabel?: (key: string, value: string) => void;
  onClickFilterOutLabel?: (key: string, value: string) => void;
  onStartScanning?: () => void;
  onStopScanning?: () => void;
  getRowContext?: (row: LogRowModel, options?: RowContextOptions) => Promise<any>;
  getFieldLinks: (field: Field, rowIndex: number) => Array<LinkModel<Field>>;
}

interface State {
  showLabels: boolean;
  showTime: boolean;
  wrapLogMessage: boolean;
  dedupStrategy: LogsDedupStrategy;
  hiddenLogLevels: LogLevel[];
  logsSortOrder: LogsSortOrder | null;
  isFlipping: boolean;
  showDetectedFields: string[];
  forceEscape: boolean;
}

export class UnthemedLogs extends PureComponent<Props, State> {
  flipOrderTimer: NodeJS.Timeout;
  cancelFlippingTimer: NodeJS.Timeout;

  state: State = {
    showLabels: store.getBool(SETTINGS_KEYS.showLabels, false),
    showTime: store.getBool(SETTINGS_KEYS.showTime, true),
    wrapLogMessage: store.getBool(SETTINGS_KEYS.wrapLogMessage, true),
    dedupStrategy: LogsDedupStrategy.none,
    hiddenLogLevels: [],
    logsSortOrder: null,
    isFlipping: false,
    showDetectedFields: [],
    forceEscape: false,
  };

  componentWillUnmount() {
    clearTimeout(this.flipOrderTimer);
    clearTimeout(this.cancelFlippingTimer);
  }

  onChangeLogsSortOrder = () => {
    this.setState({ isFlipping: true });
    // we are using setTimeout here to make sure that disabled button is rendered before the rendering of reordered logs
    this.flipOrderTimer = setTimeout(() => {
      this.setState((prevState) => {
        if (prevState.logsSortOrder === null || prevState.logsSortOrder === LogsSortOrder.Descending) {
          return { logsSortOrder: LogsSortOrder.Ascending };
        }
        return { logsSortOrder: LogsSortOrder.Descending };
      });
    }, 0);
    this.cancelFlippingTimer = setTimeout(() => this.setState({ isFlipping: false }), 1000);
  };

  onEscapeNewlines = () => {
    this.setState((prevState) => ({
      forceEscape: !prevState.forceEscape,
    }));
  };

  onChangeDedup = (dedupStrategy: LogsDedupStrategy) => {
    this.setState({ dedupStrategy });
  };

  onChangeLabels = (event?: React.SyntheticEvent) => {
    const target = event && (event.target as HTMLInputElement);
    if (target) {
      const showLabels = target.checked;
      this.setState({
        showLabels,
      });
      store.set(SETTINGS_KEYS.showLabels, showLabels);
    }
  };

  onChangeTime = (event?: React.SyntheticEvent) => {
    const target = event && (event.target as HTMLInputElement);
    if (target) {
      const showTime = target.checked;
      this.setState({
        showTime,
      });
      store.set(SETTINGS_KEYS.showTime, showTime);
    }
  };

  onChangewrapLogMessage = (event?: React.SyntheticEvent) => {
    const target = event && (event.target as HTMLInputElement);
    if (target) {
      const wrapLogMessage = target.checked;
      this.setState({
        wrapLogMessage,
      });
      store.set(SETTINGS_KEYS.wrapLogMessage, wrapLogMessage);
    }
  };

  onToggleLogLevel = (hiddenRawLevels: string[]) => {
    const hiddenLogLevels = hiddenRawLevels.map((level) => LogLevel[level as LogLevel]);
    this.setState({ hiddenLogLevels });
  };

  onClickScan = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (this.props.onStartScanning) {
      this.props.onStartScanning();
    }
  };

  onClickStopScan = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (this.props.onStopScanning) {
      this.props.onStopScanning();
    }
  };

  showDetectedField = (key: string) => {
    const index = this.state.showDetectedFields.indexOf(key);

    if (index === -1) {
      this.setState((state) => {
        return {
          showDetectedFields: state.showDetectedFields.concat(key),
        };
      });
    }
  };

  hideDetectedField = (key: string) => {
    const index = this.state.showDetectedFields.indexOf(key);
    if (index > -1) {
      this.setState((state) => {
        return {
          showDetectedFields: state.showDetectedFields.filter((k) => key !== k),
        };
      });
    }
  };

  clearDetectedFields = () => {
    this.setState((state) => {
      return {
        showDetectedFields: [],
      };
    });
  };

  checkUnescapedContent = memoizeOne((logRows: LogRowModel[]) => {
    return !!logRows.some((r) => r.hasUnescapedContent);
  });

  dedupRows = memoizeOne((logRows: LogRowModel[], dedupStrategy: LogsDedupStrategy) => {
    const dedupedRows = dedupLogRows(logRows, dedupStrategy);
    const dedupCount = dedupedRows.reduce((sum, row) => (row.duplicates ? sum + row.duplicates : sum), 0);
    return { dedupedRows, dedupCount };
  });

  filterRows = memoizeOne((logRows: LogRowModel[], hiddenLogLevels: LogLevel[]) => {
    return filterLogLevels(logRows, new Set(hiddenLogLevels));
  });

  render() {
    const {
      logRows,
      logsMeta,
      logsSeries,
      visibleRange,
      highlighterExpressions,
      loading = false,
      onClickFilterLabel,
      onClickFilterOutLabel,
      timeZone,
      scanning,
      scanRange,
      showContextToggle,
      width,
      absoluteRange,
      onChangeTime,
      getFieldLinks,
      theme,
      queries,
    } = this.props;

    const {
      showLabels,
      showTime,
      wrapLogMessage,
      dedupStrategy,
      hiddenLogLevels,
      logsSortOrder,
      isFlipping,
      showDetectedFields,
      forceEscape,
    } = this.state;

    const styles = getStyles(theme);
    const hasData = logRows && logRows.length > 0;
    const hasUnescapedContent = this.checkUnescapedContent(logRows);

    const filteredLogs = this.filterRows(logRows, hiddenLogLevels);
    const { dedupedRows, dedupCount } = this.dedupRows(filteredLogs, dedupStrategy);

    const scanText = scanRange ? `Scanning ${rangeUtil.describeTimeRange(scanRange)}` : 'Scanning...';

    return (
      <>
        <ExploreGraphPanel
          series={logsSeries || []}
          width={width}
          onHiddenSeriesChanged={this.onToggleLogLevel}
          loading={loading}
          absoluteRange={visibleRange || absoluteRange}
          isStacked={true}
          showPanel={false}
          timeZone={timeZone}
          showBars={true}
          showLines={false}
          onUpdateTimeRange={onChangeTime}
        />
        <div className={styles.logOptions}>
          <InlineFieldRow>
            <InlineField label="Time" transparent>
              <InlineSwitch value={showTime} onChange={this.onChangeTime} transparent />
            </InlineField>
            <InlineField label="Unique labels" transparent>
              <InlineSwitch value={showLabels} onChange={this.onChangeLabels} transparent />
            </InlineField>
            <InlineField label="Wrap lines" transparent>
              <InlineSwitch value={wrapLogMessage} onChange={this.onChangewrapLogMessage} transparent />
            </InlineField>
            <InlineField label="Dedup" transparent>
              <RadioButtonGroup
                options={Object.keys(LogsDedupStrategy).map((dedupType: LogsDedupStrategy) => ({
                  label: capitalize(dedupType),
                  value: dedupType,
                  description: LogsDedupDescription[dedupType],
                }))}
                value={dedupStrategy}
                onChange={this.onChangeDedup}
                className={styles.radioButtons}
              />
            </InlineField>
          </InlineFieldRow>
          <Button
            variant="secondary"
            disabled={isFlipping}
            title={logsSortOrder === LogsSortOrder.Ascending ? 'Change to newest first' : 'Change to oldest first'}
            aria-label="Flip results order"
            className={styles.flipButton}
            onClick={this.onChangeLogsSortOrder}
          >
            {isFlipping ? 'Flipping...' : 'Flip results order'}
          </Button>
        </div>
        <LogsMetaRow
          logRows={logRows}
          meta={logsMeta || []}
          dedupStrategy={dedupStrategy}
          dedupCount={dedupCount}
          hasUnescapedContent={hasUnescapedContent}
          forceEscape={forceEscape}
          showDetectedFields={showDetectedFields}
          onEscapeNewlines={this.onEscapeNewlines}
          clearDetectedFields={this.clearDetectedFields}
        />
        <div className={styles.logsSection}>
          <CustomScrollbar autoHide>
            <LogRows
              logRows={logRows}
              deduplicatedRows={dedupedRows}
              dedupStrategy={dedupStrategy}
              getRowContext={this.props.getRowContext}
              highlighterExpressions={highlighterExpressions}
              onClickFilterLabel={onClickFilterLabel}
              onClickFilterOutLabel={onClickFilterOutLabel}
              showContextToggle={showContextToggle}
              showLabels={showLabels}
              showTime={showTime}
              forceEscape={forceEscape}
              wrapLogMessage={wrapLogMessage}
              timeZone={timeZone}
              getFieldLinks={getFieldLinks}
              logsSortOrder={logsSortOrder}
              showDetectedFields={showDetectedFields}
              onClickShowDetectedField={this.showDetectedField}
              onClickHideDetectedField={this.hideDetectedField}
            />
          </CustomScrollbar>
          <LogsNavigation
            logsSortOrder={logsSortOrder}
            visibleRange={visibleRange}
            absoluteRange={absoluteRange}
            timeZone={timeZone}
            onChangeTime={onChangeTime}
            loading={loading}
            queries={queries}
          />
        </div>
        {!loading && !hasData && !scanning && (
          <div className={styles.noData}>
            No logs found.
            <Button size="xs" fill="text" onClick={this.onClickScan}>
              Scan for older logs
            </Button>
          </div>
        )}

        {scanning && (
          <div className={styles.noData}>
            <span>{scanText}</span>
            <Button size="xs" fill="text" onClick={this.onClickStopScan}>
              Stop scan
            </Button>
          </div>
        )}
      </>
    );
  }
}

export const Logs = withTheme(UnthemedLogs);

const getStyles = stylesFactory((theme: GrafanaTheme) => {
  return {
    noData: css`
      > * {
        margin-left: 0.5em;
      }
    `,
    logOptions: css`
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      background-color: ${theme.colors.bg1};
      padding: ${theme.spacing.sm} ${theme.spacing.md};
      border-radius: ${theme.border.radius.md};
      margin: ${theme.spacing.md} 0 ${theme.spacing.sm};
      border: 1px solid ${theme.colors.border2};
    `,
    flipButton: css`
      margin: ${theme.spacing.xs} 0 0 ${theme.spacing.sm};
    `,
    radioButtons: css`
      margin: 0 ${theme.spacing.sm};
    `,
    logsSection: css`
      display: flex;
      flex-direction: row;
      max-height: 95vh;
    `,
  };
});
