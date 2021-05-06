import { preparePlotConfigBuilder, preparePlotFrame } from './utils';
import { createTheme, FieldConfig, FieldType, MutableDataFrame, VizOrientation } from '@grafana/data';
import { BarChartFieldConfig, BarChartOptions, BarValueVisibility } from './types';
import { GraphGradientMode, StackingMode } from '../uPlot/config';
import { LegendDisplayMode } from '../VizLegend/models.gen';

function mockDataFrame() {
  const df1 = new MutableDataFrame({
    refId: 'A',
    fields: [{ name: 'ts', type: FieldType.string, values: ['a', 'b', 'c'] }],
  });

  const df2 = new MutableDataFrame({
    refId: 'B',
    fields: [{ name: 'ts', type: FieldType.time, values: [1, 2, 4] }],
  });

  const f1Config: FieldConfig<BarChartFieldConfig> = {
    displayName: 'Metric 1',
    decimals: 2,
    unit: 'm/s',
    custom: {
      gradientMode: GraphGradientMode.Opacity,
      lineWidth: 2,
      fillOpacity: 0.1,
    },
  };

  const f2Config: FieldConfig<BarChartFieldConfig> = {
    displayName: 'Metric 2',
    decimals: 2,
    unit: 'kWh',
    custom: {
      gradientMode: GraphGradientMode.Hue,
      lineWidth: 2,
      fillOpacity: 0.1,
    },
  };

  df1.addField({
    name: 'metric1',
    type: FieldType.number,
    config: f1Config,
    state: {},
  });

  df2.addField({
    name: 'metric2',
    type: FieldType.number,
    config: f2Config,
    state: {},
  });

  return preparePlotFrame([df1, df2]);
}

jest.mock('@grafana/data', () => ({
  ...(jest.requireActual('@grafana/data') as any),
  DefaultTimeZone: 'utc',
}));

describe('GraphNG utils', () => {
  describe('preparePlotConfigBuilder', () => {
    const frame = mockDataFrame();

    const config: BarChartOptions = {
      orientation: VizOrientation.Auto,
      groupWidth: 20,
      barWidth: 2,
      showValue: BarValueVisibility.Always,
      legend: {
        displayMode: LegendDisplayMode.List,
        placement: 'bottom',
        calcs: [],
      },
      stacking: StackingMode.None,
    };

    it.each([VizOrientation.Auto, VizOrientation.Horizontal, VizOrientation.Vertical])('orientation', (v) => {
      const result = preparePlotConfigBuilder(frame!, createTheme(), {
        ...config,
        orientation: v,
      }).getConfig();
      expect(result).toMatchSnapshot();
    });

    it.each([BarValueVisibility.Always, BarValueVisibility.Auto])('value visibility', (v) => {
      expect(
        preparePlotConfigBuilder(frame!, createTheme(), {
          ...config,
          showValue: v,
        }).getConfig()
      ).toMatchSnapshot();
    });

    it.each([StackingMode.None, StackingMode.Percent, StackingMode.Normal])('stacking', (v) => {
      expect(
        preparePlotConfigBuilder(frame!, createTheme(), {
          ...config,
          stacking: v,
        }).getConfig()
      ).toMatchSnapshot();
    });
  });
});
