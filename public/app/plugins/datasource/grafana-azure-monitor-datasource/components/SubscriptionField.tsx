import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { SelectableValue } from '@grafana/data';
import { Select } from '@grafana/ui';

import { AzureMonitorQuery, AzureQueryType, AzureQueryEditorFieldProps, AzureMonitorOption } from '../types';
import { findOption } from '../utils/common';
import { Field } from './Field';

interface SubscriptionFieldProps extends AzureQueryEditorFieldProps {
  onQueryChange: (newQuery: AzureMonitorQuery) => void;
}

const ERROR_SOURCE = 'metrics-subscription';
const SubscriptionField: React.FC<SubscriptionFieldProps> = ({
  datasource,
  query,
  variableOptionGroup,
  onQueryChange,
  setError,
}) => {
  const [subscriptions, setSubscriptions] = useState<AzureMonitorOption[]>([]);

  useEffect(() => {
    if (!datasource.azureMonitorDatasource.isConfigured()) {
      return;
    }

    datasource.azureMonitorDatasource
      .getSubscriptions()
      .then((results) => {
        const newSubscriptions = results.map((v) => ({ label: v.text, value: v.value, description: v.value }));
        setSubscriptions(newSubscriptions);
        setError(ERROR_SOURCE, undefined);

        // Set a default subscription ID, if we can
        let newSubscription = query.subscription;

        if (!newSubscription && query.queryType === AzureQueryType.AzureMonitor) {
          newSubscription = datasource.azureMonitorDatasource.subscriptionId;
        } else if (!query.subscription && query.queryType === AzureQueryType.LogAnalytics) {
          newSubscription =
            datasource.azureLogAnalyticsDatasource.logAnalyticsSubscriptionId ||
            datasource.azureLogAnalyticsDatasource.subscriptionId;
        }

        if (!newSubscription && newSubscriptions.length > 0) {
          newSubscription = newSubscriptions[0].value;
        }

        newSubscription !== query.subscription &&
          onQueryChange({
            ...query,
            subscription: newSubscription,
          });
      })
      .catch((err) => setError(ERROR_SOURCE, err));
  }, [
    datasource.azureLogAnalyticsDatasource?.logAnalyticsSubscriptionId,
    datasource.azureLogAnalyticsDatasource?.subscriptionId,
    datasource.azureMonitorDatasource,
    onQueryChange,
    query,
    setError,
  ]);

  const handleChange = useCallback(
    (change: SelectableValue<string>) => {
      if (!change.value) {
        return;
      }

      let newQuery: AzureMonitorQuery = {
        ...query,
        subscription: change.value,
      };

      if (query.queryType === AzureQueryType.AzureMonitor) {
        // TODO: set the fields to undefined so we don't
        // get "resource group select could not be found" errors
        newQuery.azureMonitor = {
          ...newQuery.azureMonitor,
          resourceGroup: undefined,
          metricDefinition: undefined,
          metricNamespace: undefined,
          resourceName: undefined,
          metricName: undefined,
          aggregation: undefined,
          timeGrain: '',
          dimensionFilters: [],
        };
      }

      onQueryChange(newQuery);
    },
    [query, onQueryChange]
  );

  const options = useMemo(() => [...subscriptions, variableOptionGroup], [subscriptions, variableOptionGroup]);

  return (
    <Field label="Subscription">
      <Select
        value={findOption(subscriptions, query.subscription)}
        inputId="azure-monitor-subscriptions-field"
        onChange={handleChange}
        options={options}
        width={38}
      />
    </Field>
  );
};

export default SubscriptionField;
