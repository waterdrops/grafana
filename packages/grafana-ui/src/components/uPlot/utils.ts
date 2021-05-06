import { DataFrame, dateTime, Field, FieldType } from '@grafana/data';
import { StackingMode } from './config';
import { createLogger } from '../../utils/logger';
import { attachDebugger } from '../../utils';
import { AlignedData, Options, PaddingSide } from 'uplot';

const ALLOWED_FORMAT_STRINGS_REGEX = /\b(YYYY|YY|MMMM|MMM|MM|M|DD|D|WWWW|WWW|HH|H|h|AA|aa|a|mm|m|ss|s|fff)\b/g;

export function timeFormatToTemplate(f: string) {
  return f.replace(ALLOWED_FORMAT_STRINGS_REGEX, (match) => `{${match}}`);
}

const paddingSide: PaddingSide = (u, side, sidesWithAxes) => {
  let hasCrossAxis = side % 2 ? sidesWithAxes[0] || sidesWithAxes[2] : sidesWithAxes[1] || sidesWithAxes[3];

  return sidesWithAxes[side] || !hasCrossAxis ? 0 : 8;
};

export const DEFAULT_PLOT_CONFIG: Partial<Options> = {
  focus: {
    alpha: 1,
  },
  cursor: {
    focus: {
      prox: 30,
    },
  },
  legend: {
    show: false,
  },
  padding: [paddingSide, paddingSide, paddingSide, paddingSide],
  series: [],
  hooks: {},
};

/** @internal */
export function preparePlotData(frame: DataFrame, keepFieldTypes?: FieldType[]): AlignedData {
  const result: any[] = [];
  const stackingGroups: Map<string, number[]> = new Map();
  let seriesIndex = 0;

  for (let i = 0; i < frame.fields.length; i++) {
    const f = frame.fields[i];

    if (f.type === FieldType.time) {
      if (f.values.length > 0 && typeof f.values.get(0) === 'string') {
        const timestamps = [];
        for (let i = 0; i < f.values.length; i++) {
          timestamps.push(dateTime(f.values.get(i)).valueOf());
        }
        result.push(timestamps);
        seriesIndex++;
        continue;
      }
      result.push(f.values.toArray());
      seriesIndex++;
      continue;
    }

    if (keepFieldTypes && keepFieldTypes.indexOf(f.type) < 0) {
      continue;
    }

    collectStackingGroups(f, stackingGroups, seriesIndex);
    result.push(f.values.toArray());
    seriesIndex++;
  }

  // Stacking
  if (stackingGroups.size !== 0) {
    // array or stacking groups
    for (const [_, seriesIdxs] of stackingGroups.entries()) {
      const acc = Array(result[0].length).fill(0);

      for (let j = 0; j < seriesIdxs.length; j++) {
        const currentlyStacking = result[seriesIdxs[j]];

        for (let k = 0; k < result[0].length; k++) {
          const v = currentlyStacking[k];
          acc[k] += v == null ? 0 : +v;
        }

        result[seriesIdxs[j]] = acc.slice();
      }
    }
  }

  return result as AlignedData;
}

export function collectStackingGroups(f: Field, groups: Map<string, number[]>, seriesIdx: number) {
  const customConfig = f.config.custom;
  if (!customConfig) {
    return;
  }
  if (
    customConfig.stacking?.mode !== StackingMode.None &&
    customConfig.stacking?.group &&
    !customConfig.hideFrom?.graph
  ) {
    if (!groups.has(customConfig.stacking.group)) {
      groups.set(customConfig.stacking.group, [seriesIdx]);
    } else {
      groups.set(customConfig.stacking.group, groups.get(customConfig.stacking.group)!.concat(seriesIdx));
    }
  }
}

// Dev helpers

/** @internal */
export const pluginLogger = createLogger('uPlot Plugin');
export const pluginLog = pluginLogger.logger;
// pluginLogger.enable();
attachDebugger('graphng', undefined, pluginLogger);
