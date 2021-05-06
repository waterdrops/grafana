import { isNumber } from 'lodash';
import {
  DataFrame,
  FieldConfig,
  FieldType,
  formattedValueToString,
  getFieldColorModeForField,
  getFieldDisplayName,
  getFieldSeriesColor,
} from '@grafana/data';

import { PrepConfigOpts } from '../GraphNG/utils';
import { UPlotConfigBuilder } from '../uPlot/config/UPlotConfigBuilder';
import { FIXED_UNIT } from '../GraphNG/GraphNG';
import {
  AxisPlacement,
  DrawStyle,
  GraphFieldConfig,
  GraphTresholdsStyleMode,
  PointVisibility,
  ScaleDirection,
  ScaleOrientation,
} from '../uPlot/config';
import { collectStackingGroups } from '../uPlot/utils';

const defaultFormatter = (v: any) => (v == null ? '-' : v.toFixed(1));

const defaultConfig: GraphFieldConfig = {
  drawStyle: DrawStyle.Line,
  showPoints: PointVisibility.Auto,
  axisPlacement: AxisPlacement.Auto,
};

type PrepConfig = (opts: PrepConfigOpts) => UPlotConfigBuilder;

export const preparePlotConfigBuilder: PrepConfig = ({ frame, theme, timeZone, getTimeRange }) => {
  const builder = new UPlotConfigBuilder(timeZone);

  // X is the first field in the aligned frame
  const xField = frame.fields[0];
  if (!xField) {
    return builder; // empty frame with no options
  }

  let seriesIndex = 0;

  if (xField.type === FieldType.time) {
    builder.addScale({
      scaleKey: 'x',
      orientation: ScaleOrientation.Horizontal,
      direction: ScaleDirection.Right,
      isTime: true,
      range: () => {
        const timeRange = getTimeRange();
        return [timeRange.from.valueOf(), timeRange.to.valueOf()];
      },
    });

    builder.addAxis({
      scaleKey: 'x',
      isTime: true,
      placement: AxisPlacement.Bottom,
      timeZone,
      theme,
    });
  } else {
    // Not time!
    builder.addScale({
      scaleKey: 'x',
      orientation: ScaleOrientation.Horizontal,
      direction: ScaleDirection.Right,
    });

    builder.addAxis({
      scaleKey: 'x',
      placement: AxisPlacement.Bottom,
      theme,
    });
  }

  const stackingGroups: Map<string, number[]> = new Map();

  let indexByName: Map<string, number> | undefined = undefined;

  for (let i = 0; i < frame.fields.length; i++) {
    const field = frame.fields[i];
    const config = field.config as FieldConfig<GraphFieldConfig>;
    const customConfig: GraphFieldConfig = {
      ...defaultConfig,
      ...config.custom,
    };

    if (field === xField || field.type !== FieldType.number) {
      continue;
    }
    field.state!.seriesIndex = seriesIndex++;

    const fmt = field.display ?? defaultFormatter;
    const scaleKey = config.unit || FIXED_UNIT;
    const colorMode = getFieldColorModeForField(field);
    const scaleColor = getFieldSeriesColor(field, theme);
    const seriesColor = scaleColor.color;

    // The builder will manage unique scaleKeys and combine where appropriate
    builder.addScale({
      scaleKey,
      orientation: ScaleOrientation.Vertical,
      direction: ScaleDirection.Up,
      distribution: customConfig.scaleDistribution?.type,
      log: customConfig.scaleDistribution?.log,
      min: field.config.min,
      max: field.config.max,
      softMin: customConfig.axisSoftMin,
      softMax: customConfig.axisSoftMax,
    });

    if (customConfig.axisPlacement !== AxisPlacement.Hidden) {
      builder.addAxis({
        scaleKey,
        label: customConfig.axisLabel,
        size: customConfig.axisWidth,
        placement: customConfig.axisPlacement ?? AxisPlacement.Auto,
        formatValue: (v) => formattedValueToString(fmt(v)),
        theme,
      });
    }

    const showPoints = customConfig.drawStyle === DrawStyle.Points ? PointVisibility.Always : customConfig.showPoints;

    let { fillOpacity } = customConfig;

    if (customConfig.fillBelowTo) {
      if (!indexByName) {
        indexByName = getNamesToFieldIndex(frame);
      }
      const t = indexByName.get(getFieldDisplayName(field, frame));
      const b = indexByName.get(customConfig.fillBelowTo);
      if (isNumber(b) && isNumber(t)) {
        builder.addBand({
          series: [t, b],
          fill: null as any, // using null will have the band use fill options from `t`
        });
      }
      if (!fillOpacity) {
        fillOpacity = 35; // default from flot
      }
    }

    builder.addSeries({
      scaleKey,
      showPoints,
      colorMode,
      fillOpacity,
      theme,
      drawStyle: customConfig.drawStyle!,
      lineColor: customConfig.lineColor ?? seriesColor,
      lineWidth: customConfig.lineWidth,
      lineInterpolation: customConfig.lineInterpolation,
      lineStyle: customConfig.lineStyle,
      barAlignment: customConfig.barAlignment,
      pointSize: customConfig.pointSize,
      pointColor: customConfig.pointColor ?? seriesColor,
      spanNulls: customConfig.spanNulls || false,
      show: !customConfig.hideFrom?.graph,
      gradientMode: customConfig.gradientMode,
      thresholds: config.thresholds,

      // The following properties are not used in the uPlot config, but are utilized as transport for legend config
      dataFrameFieldIndex: field.state?.origin,
      fieldName: getFieldDisplayName(field, frame),
      hideInLegend: customConfig.hideFrom?.legend,
    });

    // Render thresholds in graph
    if (customConfig.thresholdsStyle && config.thresholds) {
      const thresholdDisplay = customConfig.thresholdsStyle.mode ?? GraphTresholdsStyleMode.Off;
      if (thresholdDisplay !== GraphTresholdsStyleMode.Off) {
        builder.addThresholds({
          config: customConfig.thresholdsStyle,
          thresholds: config.thresholds,
          scaleKey,
          theme,
        });
      }
    }

    collectStackingGroups(field, stackingGroups, seriesIndex);
  }

  if (stackingGroups.size !== 0) {
    builder.setStacking(true);
    for (const [_, seriesIdxs] of stackingGroups.entries()) {
      for (let j = seriesIdxs.length - 1; j > 0; j--) {
        builder.addBand({
          series: [seriesIdxs[j], seriesIdxs[j - 1]],
        });
      }
    }
  }
  return builder;
};

export function getNamesToFieldIndex(frame: DataFrame): Map<string, number> {
  const names = new Map<string, number>();
  for (let i = 0; i < frame.fields.length; i++) {
    names.set(getFieldDisplayName(frame.fields[i], frame), i);
  }
  return names;
}
