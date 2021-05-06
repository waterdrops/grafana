import {
  AppEvents,
  applyFieldOverrides,
  dataFrameFromJSON,
  DataFrameJSON,
  DataQuery,
  DataSourceApi,
} from '@grafana/data';
import { config, getBackendSrv, getDataSourceSrv, locationService } from '@grafana/runtime';
import { appEvents } from 'app/core/core';
import store from 'app/core/store';
import {
  ALERT_DEFINITION_UI_STATE_STORAGE_KEY,
  cleanUpState,
  loadAlertRules,
  loadedAlertRules,
  notificationChannelLoaded,
  setAlertDefinition,
  setAlertDefinitions,
  setInstanceData,
  setNotificationChannels,
  setUiState,
  updateAlertDefinitionOptions,
} from './reducers';
import {
  AlertDefinition,
  AlertDefinitionState,
  AlertDefinitionUiState,
  AlertRuleDTO,
  NotifierDTO,
  QueryGroupDataSource,
  QueryGroupOptions,
  ThunkResult,
} from 'app/types';
import { ExpressionDatasourceID } from '../../expressions/ExpressionDatasource';
import { isExpressionQuery } from 'app/features/expressions/guards';

export function getAlertRulesAsync(options: { state: string }): ThunkResult<void> {
  return async (dispatch) => {
    dispatch(loadAlertRules());
    const rules: AlertRuleDTO[] = await getBackendSrv().get('/api/alerts', options);

    if (config.featureToggles.ngalert) {
      const ngAlertDefinitions = await getBackendSrv().get('/api/alert-definitions');
      dispatch(setAlertDefinitions(ngAlertDefinitions.results));
    }

    dispatch(loadedAlertRules(rules));
  };
}

export function togglePauseAlertRule(id: number, options: { paused: boolean }): ThunkResult<void> {
  return async (dispatch) => {
    await getBackendSrv().post(`/api/alerts/${id}/pause`, options);
    const stateFilter = locationService.getSearchObject().state || 'all';
    dispatch(getAlertRulesAsync({ state: stateFilter.toString() }));
  };
}

export function createNotificationChannel(data: any): ThunkResult<void> {
  return async (dispatch) => {
    try {
      await getBackendSrv().post(`/api/alert-notifications`, data);
      appEvents.emit(AppEvents.alertSuccess, ['Notification created']);
      locationService.push('/alerting/notifications');
    } catch (error) {
      appEvents.emit(AppEvents.alertError, [error.data.error]);
    }
  };
}

export function updateNotificationChannel(data: any): ThunkResult<void> {
  return async (dispatch) => {
    try {
      await getBackendSrv().put(`/api/alert-notifications/${data.id}`, data);
      appEvents.emit(AppEvents.alertSuccess, ['Notification updated']);
    } catch (error) {
      appEvents.emit(AppEvents.alertError, [error.data.error]);
    }
  };
}

export function testNotificationChannel(data: any): ThunkResult<void> {
  return async (dispatch, getState) => {
    const channel = getState().notificationChannel.notificationChannel;
    await getBackendSrv().post('/api/alert-notifications/test', { id: channel.id, ...data });
  };
}

export function loadNotificationTypes(): ThunkResult<void> {
  return async (dispatch) => {
    const alertNotifiers: NotifierDTO[] = await getBackendSrv().get(`/api/alert-notifiers`);

    const notificationTypes = alertNotifiers.sort((o1, o2) => {
      if (o1.name > o2.name) {
        return 1;
      }
      return -1;
    });

    dispatch(setNotificationChannels(notificationTypes));
  };
}

export function loadNotificationChannel(id: number): ThunkResult<void> {
  return async (dispatch) => {
    await dispatch(loadNotificationTypes());
    const notificationChannel = await getBackendSrv().get(`/api/alert-notifications/${id}`);
    dispatch(notificationChannelLoaded(notificationChannel));
  };
}

export function getAlertDefinition(id: string): ThunkResult<void> {
  return async (dispatch) => {
    const alertDefinition = await getBackendSrv().get(`/api/alert-definitions/${id}`);
    dispatch(setAlertDefinition(alertDefinition));
  };
}

export function createAlertDefinition(): ThunkResult<void> {
  return async (dispatch, getStore) => {
    const alertDefinition = await buildAlertDefinition(getStore().alertDefinition);
    await getBackendSrv().post(`/api/alert-definitions`, alertDefinition);
    appEvents.emit(AppEvents.alertSuccess, ['Alert definition created']);
    locationService.push('/alerting/ng/list');
  };
}

export function updateAlertDefinition(): ThunkResult<void> {
  return async (dispatch, getStore) => {
    const alertDefinition = await buildAlertDefinition(getStore().alertDefinition);

    const updatedAlertDefinition = await getBackendSrv().put(
      `/api/alert-definitions/${alertDefinition.uid}`,
      alertDefinition
    );
    appEvents.emit(AppEvents.alertSuccess, ['Alert definition updated']);
    dispatch(setAlertDefinition(updatedAlertDefinition));
  };
}

export function updateAlertDefinitionUiState(uiState: Partial<AlertDefinitionUiState>): ThunkResult<void> {
  return (dispatch, getStore) => {
    const nextState = { ...getStore().alertDefinition.uiState, ...uiState };
    dispatch(setUiState(nextState));

    try {
      store.setObject(ALERT_DEFINITION_UI_STATE_STORAGE_KEY, nextState);
    } catch (error) {
      console.error(error);
    }
  };
}

export function updateAlertDefinitionOption(alertDefinition: Partial<AlertDefinition>): ThunkResult<void> {
  return (dispatch) => {
    dispatch(updateAlertDefinitionOptions(alertDefinition));
  };
}

export function evaluateAlertDefinition(): ThunkResult<void> {
  return async (dispatch, getStore) => {
    const { alertDefinition } = getStore().alertDefinition;

    const response: { instances: DataFrameJSON[] } = await getBackendSrv().get(
      `/api/alert-definitions/eval/${alertDefinition.uid}`
    );

    const handledResponse = handleJSONResponse(response.instances);

    dispatch(setInstanceData(handledResponse));
    appEvents.emit(AppEvents.alertSuccess, ['Alert definition tested successfully']);
  };
}

export function evaluateNotSavedAlertDefinition(): ThunkResult<void> {
  return async (dispatch, getStore) => {
    const { alertDefinition } = getStore().alertDefinition;
    const defaultDataSource = await getDataSourceSrv().get(null);

    const response: { instances: DataFrameJSON[] } = await getBackendSrv().post('/api/alert-definitions/eval', {
      condition: alertDefinition.condition,
      data: buildDataQueryModel({} as QueryGroupOptions, defaultDataSource),
    });

    const handledResponse = handleJSONResponse(response.instances);
    dispatch(setInstanceData(handledResponse));
    appEvents.emit(AppEvents.alertSuccess, ['Alert definition tested successfully']);
  };
}

export function cleanUpDefinitionState(): ThunkResult<void> {
  return (dispatch) => {
    dispatch(cleanUpState(undefined));
  };
}

async function buildAlertDefinition(state: AlertDefinitionState) {
  const queryOptions = {} as QueryGroupOptions;
  const currentAlertDefinition = state.alertDefinition;
  const defaultDataSource = await getDataSourceSrv().get(null);

  return {
    ...currentAlertDefinition,
    data: buildDataQueryModel(queryOptions, defaultDataSource),
  };
}

function handleJSONResponse(frames: DataFrameJSON[]) {
  const dataFrames = frames.map((instance) => {
    return dataFrameFromJSON(instance);
  });

  return applyFieldOverrides({
    data: dataFrames,
    fieldConfig: {
      defaults: {},
      overrides: [],
    },
    replaceVariables: (value: any) => value,
    theme: config.theme2,
  });
}

function buildDataQueryModel(queryOptions: QueryGroupOptions, defaultDataSource: DataSourceApi) {
  return queryOptions.queries.map((query: DataQuery) => {
    if (isExpressionQuery(query)) {
      const dataSource: QueryGroupDataSource = {
        name: ExpressionDatasourceID,
        uid: ExpressionDatasourceID,
      };

      return {
        model: {
          ...query,
          type: query.type,
          datasource: dataSource.name,
          datasourceUid: dataSource.uid,
        },
        refId: query.refId,
      };
    }

    const dataSourceSetting = getDataSourceSrv().getInstanceSettings(query.datasource);
    const dataSource: QueryGroupDataSource = {
      name: dataSourceSetting?.name ?? defaultDataSource.name,
      uid: dataSourceSetting?.uid ?? defaultDataSource.uid,
    };

    return {
      model: {
        ...query,
        type: query.queryType,
        datasource: dataSource.name,
        datasourceUid: dataSource.uid,
      },
      refId: query.refId,
      relativeTimeRange: {
        from: 600,
        to: 0,
      },
    };
  });
}
