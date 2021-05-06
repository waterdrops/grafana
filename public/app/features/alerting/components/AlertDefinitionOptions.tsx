import React, { FC, FormEvent } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme, SelectableValue } from '@grafana/data';
import { Field, Input, Select, Tab, TabContent, TabsBar, TextArea, useStyles } from '@grafana/ui';
import { AlertDefinition } from 'app/types';

const intervalOptions: Array<SelectableValue<number>> = [
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
];

interface Props {
  alertDefinition: AlertDefinition;
  onChange: (event: FormEvent<HTMLElement>) => void;
  onIntervalChange: (interval: SelectableValue<number>) => void;
  onConditionChange: (refId: SelectableValue<string>) => void;
}

export const AlertDefinitionOptions: FC<Props> = ({ alertDefinition, onChange, onIntervalChange }) => {
  const styles = useStyles(getStyles);

  return (
    <div className={styles.wrapper}>
      <TabsBar>
        <Tab label="Alert definition" active={true} />
      </TabsBar>
      <TabContent className={styles.container}>
        <Field label="Title">
          <Input width={25} name="title" value={alertDefinition.title} onChange={onChange} />
        </Field>
        <Field label="Description" description="What does the alert do? Why was it created?">
          <TextArea
            rows={5}
            width={25}
            name="description"
            value={alertDefinition.description}
            onChange={onChange}
            readOnly={true}
          />
        </Field>
        <Field label="Evaluate">
          <div className={styles.optionRow}>
            <span className={styles.optionName}>Every</span>
            <Select
              onChange={onIntervalChange}
              value={intervalOptions.find((i) => i.value === alertDefinition.intervalSeconds)}
              options={intervalOptions}
              width={10}
            />
          </div>
        </Field>
        <Field label="Conditions">
          <div />
        </Field>
      </TabContent>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme) => {
  return {
    wrapper: css`
      padding-top: ${theme.spacing.md};
      height: 100%;
    `,
    container: css`
      padding: ${theme.spacing.md};
      background-color: ${theme.colors.panelBg};
      height: 100%;
      border-left: 1px solid ${theme.colors.border1};
    `,
    optionRow: css`
      display: flex;
      align-items: baseline;
    `,
    optionName: css`
      font-size: ${theme.typography.size.md};
      color: ${theme.colors.formInputText};
      margin-right: ${theme.spacing.sm};
    `,
  };
};
