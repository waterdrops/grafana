package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana/pkg/api/response"
	"github.com/grafana/grafana/pkg/models"
	"github.com/grafana/grafana/pkg/services/datasourceproxy"
	"github.com/grafana/grafana/pkg/services/datasources"
	apimodels "github.com/grafana/grafana/pkg/services/ngalert/api/tooling/definitions"
	"github.com/grafana/grafana/pkg/services/ngalert/eval"
	ngmodels "github.com/grafana/grafana/pkg/services/ngalert/models"
	"github.com/grafana/grafana/pkg/setting"
	"github.com/grafana/grafana/pkg/tsdb"
	"github.com/grafana/grafana/pkg/util"
	"gopkg.in/macaron.v1"
	"gopkg.in/yaml.v3"
)

var searchRegex = regexp.MustCompile(`\{(\w+)\}`)

func toMacaronPath(path string) string {
	return string(searchRegex.ReplaceAllFunc([]byte(path), func(s []byte) []byte {
		m := string(s[1 : len(s)-1])
		return []byte(fmt.Sprintf(":%s", m))
	}))
}

func backendType(ctx *models.ReqContext, cache datasources.CacheService) (apimodels.Backend, error) {
	recipient := ctx.Params("Recipient")
	if recipient == apimodels.GrafanaBackend.String() {
		return apimodels.GrafanaBackend, nil
	}
	if datasourceID, err := strconv.ParseInt(recipient, 10, 64); err == nil {
		if ds, err := cache.GetDatasource(datasourceID, ctx.SignedInUser, ctx.SkipCache); err == nil {
			switch ds.Type {
			case "loki", "prometheus":
				return apimodels.LoTexRulerBackend, nil
			case "alertmanager":
				return apimodels.AlertmanagerBackend, nil
			default:
				return 0, fmt.Errorf("unexpected backend type (%v)", ds.Type)
			}
		}
	}
	return 0, fmt.Errorf("unexpected backend type (%v)", recipient)
}

// macaron unsafely asserts the http.ResponseWriter is an http.CloseNotifier, which will panic.
// Here we impl it, which will ensure this no longer happens, but neither will we take
// advantage cancelling upstream requests when the downstream has closed.
// NB: http.CloseNotifier is a deprecated ifc from before the context pkg.
type safeMacaronWrapper struct {
	http.ResponseWriter
}

func (w *safeMacaronWrapper) CloseNotify() <-chan bool {
	return make(chan bool)
}

// replacedResponseWriter overwrites the underlying responsewriter used by a *models.ReqContext.
// It's ugly because it needs to replace a value behind a few nested pointers.
func replacedResponseWriter(ctx *models.ReqContext) (*models.ReqContext, *response.NormalResponse) {
	resp := response.CreateNormalResponse(make(http.Header), nil, 0)
	cpy := *ctx
	cpyMCtx := *cpy.Context
	cpyMCtx.Resp = macaron.NewResponseWriter(ctx.Req.Method, &safeMacaronWrapper{resp})
	cpy.Context = &cpyMCtx
	return &cpy, resp
}

type AlertingProxy struct {
	DataProxy *datasourceproxy.DatasourceProxyService
}

// withReq proxies a different request
func (p *AlertingProxy) withReq(
	ctx *models.ReqContext,
	method string,
	u *url.URL,
	body io.Reader,
	extractor func([]byte) (interface{}, error),
	headers map[string]string,
) response.Response {
	req, err := http.NewRequest(method, u.String(), body)
	if err != nil {
		return response.Error(400, err.Error(), nil)
	}
	for h, v := range headers {
		req.Header.Add(h, v)
	}
	newCtx, resp := replacedResponseWriter(ctx)
	newCtx.Req.Request = req
	p.DataProxy.ProxyDatasourceRequestWithID(newCtx, ctx.ParamsInt64("Recipient"))

	status := resp.Status()
	if status >= 400 {
		errMessage := string(resp.Body())
		// if Content-Type is application/json
		// and it is successfully decoded and contains a message
		// return this as response error message
		if strings.HasPrefix(resp.Header().Get("Content-Type"), "application/json") {
			var m map[string]interface{}
			if err := json.Unmarshal(resp.Body(), &m); err == nil {
				if message, ok := m["message"]; ok {
					errMessage = message.(string)
				}
			}
		}
		return response.Error(status, errMessage, nil)
	}

	t, err := extractor(resp.Body())
	if err != nil {
		return response.Error(500, err.Error(), nil)
	}

	b, err := json.Marshal(t)
	if err != nil {
		return response.Error(500, err.Error(), nil)
	}

	return response.JSON(status, b)
}

func yamlExtractor(v interface{}) func([]byte) (interface{}, error) {
	return func(b []byte) (interface{}, error) {
		decoder := yaml.NewDecoder(bytes.NewReader(b))
		decoder.KnownFields(true)

		err := decoder.Decode(v)

		return v, err
	}
}

func jsonExtractor(v interface{}) func([]byte) (interface{}, error) {
	if v == nil {
		// json unmarshal expects a pointer
		v = &map[string]interface{}{}
	}
	return func(b []byte) (interface{}, error) {
		return v, json.Unmarshal(b, v)
	}
}

func messageExtractor(b []byte) (interface{}, error) {
	return map[string]string{"message": string(b)}, nil
}

func validateCondition(c ngmodels.Condition, user *models.SignedInUser, skipCache bool, datasourceCache datasources.CacheService) error {
	if len(c.Data) == 0 {
		return nil
	}

	refIDs, err := validateQueriesAndExpressions(c.Data, user, skipCache, datasourceCache)
	if err != nil {
		return err
	}

	t := make([]string, 0, len(refIDs))
	for refID := range refIDs {
		t = append(t, refID)
	}
	if _, ok := refIDs[c.Condition]; !ok {
		return fmt.Errorf("condition %s not found in any query or expression: it should be one of: [%s]", c.Condition, strings.Join(t, ","))
	}
	return nil
}

func validateQueriesAndExpressions(data []ngmodels.AlertQuery, user *models.SignedInUser, skipCache bool, datasourceCache datasources.CacheService) (map[string]struct{}, error) {
	refIDs := make(map[string]struct{})
	if len(data) == 0 {
		return nil, nil
	}

	for _, query := range data {
		datasourceUID, err := query.GetDatasource()
		if err != nil {
			return nil, err
		}

		isExpression, err := query.IsExpression()
		if err != nil {
			return nil, err
		}
		if isExpression {
			refIDs[query.RefID] = struct{}{}
			continue
		}

		_, err = datasourceCache.GetDatasourceByUID(datasourceUID, user, skipCache)
		if err != nil {
			return nil, fmt.Errorf("invalid query %s: %w: %s", query.RefID, err, datasourceUID)
		}
		refIDs[query.RefID] = struct{}{}
	}
	return refIDs, nil
}

func conditionEval(c *models.ReqContext, cmd ngmodels.EvalAlertConditionCommand, datasourceCache datasources.CacheService, dataService *tsdb.Service, cfg *setting.Cfg) response.Response {
	evalCond := ngmodels.Condition{
		Condition: cmd.Condition,
		OrgID:     c.SignedInUser.OrgId,
		Data:      cmd.Data,
	}
	if err := validateCondition(evalCond, c.SignedInUser, c.SkipCache, datasourceCache); err != nil {
		return response.Error(400, "invalid condition", err)
	}

	now := cmd.Now
	if now.IsZero() {
		now = timeNow()
	}

	evaluator := eval.Evaluator{Cfg: cfg}
	evalResults, err := evaluator.ConditionEval(&evalCond, now, dataService)
	if err != nil {
		return response.Error(http.StatusBadRequest, "Failed to evaluate conditions", err)
	}

	frame := evalResults.AsDataFrame()

	return response.JSONStreaming(http.StatusOK, util.DynMap{
		"instances": []*data.Frame{&frame},
	})
}
