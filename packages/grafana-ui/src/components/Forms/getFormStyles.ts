import { stylesFactory } from '../../themes';
import { GrafanaTheme } from '@grafana/data';
import { getLabelStyles } from './Label';
import { getLegendStyles } from './Legend';
import { getFieldValidationMessageStyles } from './FieldValidationMessage';
import { getButtonStyles, ButtonVariant } from '../Button';
import { ComponentSize } from '../../types/size';
import { getInputStyles } from '../Input/Input';
import { getCheckboxStyles } from './Checkbox';

/** @deprecated */
export const getFormStyles = stylesFactory(
  (theme: GrafanaTheme, options: { variant: ButtonVariant; size: ComponentSize; invalid: boolean }) => {
    console.warn('getFormStyles is deprecated');

    return {
      label: getLabelStyles(theme),
      legend: getLegendStyles(theme),
      fieldValidationMessage: getFieldValidationMessageStyles(theme),
      button: getButtonStyles({
        theme,
        variant: options.variant,
        size: options.size,
      }),
      input: getInputStyles({ theme, invalid: options.invalid }),
      checkbox: getCheckboxStyles(theme),
    };
  }
);
