(function(global) {
  'use strict';

  global.StoreAdminSettingsReview = {
    create: function(context) {
      var createElement = context.createElement;
      var downloadAdminCsv = context.downloadAdminCsv;
      var formatDate = context.formatDate;
      var formatError = context.formatError;
      var requestJson = context.requestJson;
      var setStatus = context.setStatus;
      var t = context.t;

      function interpolate(value, replacements) {
        var values = replacements || {};
        return String(value || '').replace(/%\{([A-Za-z0-9_]+)\}/g, function(match, name) {
          return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match;
        });
      }

      function text(key, fallback, replacements) {
        var localized = t(key, replacements);
        return !localized || localized === key ? interpolate(fallback, replacements) : localized;
      }

      function createReviewTable(headers) {
        var table = createElement('table', 'admin-store-readiness__table');
        var head = document.createElement('thead');
        var headRow = document.createElement('tr');
        headers.forEach(function(label) {
          headRow.appendChild(createElement('th', '', label));
        });
        head.appendChild(headRow);
        table.appendChild(head);
        var body = document.createElement('tbody');
        table.appendChild(body);
        return { table: table, body: body, headers: headers };
      }

      function appendCells(reviewTable, row, values) {
        values.forEach(function(value, index) {
          var cell = createElement('td', '', value);
          cell.dataset.label = reviewTable.headers[index] || '';
          row.appendChild(cell);
        });
      }

      function sessionClientLabel(session) {
        var client = session && session.client ? session.client : {};
        return [client.browser, client.operatingSystem, client.device].filter(Boolean).join(' / ') ||
          text('adminValueUnavailable', 'Unavailable');
      }

      function hydrateSessionReview(root) {
        if (root.querySelector('[data-admin-session-results]')) return;
        root.replaceChildren();
        var actions = createElement('div', 'admin-store-readiness__actions');
        var refresh = createElement('button', 'btn btn--secondary', text('adminSessionsRefresh', 'Refresh sessions'));
        refresh.type = 'button';
        refresh.addEventListener('click', function() { loadSessionReview(root, { force: true }); });
        actions.appendChild(refresh);
        var status = createElement('p', 'admin-dashboard__status');
        status.dataset.adminSessionStatus = 'true';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        var results = createElement('div', 'admin-session-review__results');
        results.dataset.adminSessionResults = 'true';
        root.appendChild(actions);
        root.appendChild(status);
        root.appendChild(results);
      }

      function renderSessions(root, data) {
        var results = root.querySelector('[data-admin-session-results]');
        if (!results) return;
        results.replaceChildren();
        var active = Array.isArray(data && data.active) ? data.active : [];
        var recent = Array.isArray(data && data.recent) ? data.recent : [];
        results.appendChild(createElement('p', 'admin-app__muted', text(
          'adminSessionsSummary',
          'Active sessions: %{count}. Login metadata is retained for %{days} days without full IP addresses, full user agents, or precise location.',
          { count: active.length, days: data && data.retentionDays || 30 }
        )));

        results.appendChild(createElement('h3', 'admin-card-heading', text('adminSessionsActiveTitle', 'Active sessions')));
        if (!active.length) {
          results.appendChild(createElement('p', 'admin-app__muted', text('adminSessionsNoneActive', 'No active sessions.')));
        } else {
          var activeTable = createReviewTable([
            text('adminSessionsAdmin', 'Admin'),
            text('adminSessionsClient', 'Client'),
            text('adminSessionsStarted', 'Started'),
            text('adminSessionsExpires', 'Expires'),
            text('adminSessionsAction', 'Action')
          ]);
          active.forEach(function(session) {
            var row = document.createElement('tr');
            appendCells(activeTable, row, [
              session.email || text('adminValueUnknown', 'Unknown'),
              sessionClientLabel(session),
              formatDate(session.createdAt),
              formatDate(session.expiresAt)
            ]);
            var actionCell = document.createElement('td');
            actionCell.dataset.label = activeTable.headers[4];
            if (session.current) {
              actionCell.appendChild(createElement('span', 'admin-app__muted', text('adminSessionsCurrent', 'Current session')));
            } else {
              var revoke = createElement('button', 'btn btn--secondary btn--small', text('adminSessionsRevoke', 'Revoke'));
              revoke.type = 'button';
              revoke.addEventListener('click', function() {
                revoke.disabled = true;
                var status = root.querySelector('[data-admin-session-status]');
                setStatus(status, text('adminSessionsRevoking', 'Revoking session...'));
                requestJson('/admin/sessions/revoke', { method: 'POST', body: { id: session.id } }).then(function() {
                  root.dataset.adminSessionState = '';
                  return loadSessionReview(root, { force: true }).then(function() {
                    setStatus(status, text('adminSessionsRevoked', 'Session revoked.'));
                  });
                }).catch(function(error) {
                  setStatus(status, formatError(error), true);
                  revoke.disabled = false;
                });
              });
              actionCell.appendChild(revoke);
            }
            row.appendChild(actionCell);
            activeTable.body.appendChild(row);
          });
          results.appendChild(activeTable.table);
        }

        results.appendChild(createElement('h3', 'admin-card-heading', text('adminSessionsRecentTitle', 'Recent logins')));
        if (!recent.length) {
          results.appendChild(createElement('p', 'admin-app__muted', text('adminSessionsNoneRecent', 'No recent logins.')));
          return;
        }
        var recentTable = createReviewTable([
          text('adminSessionsAdmin', 'Admin'),
          text('adminSessionsClient', 'Client'),
          text('adminSessionsNetworkId', 'Network ID'),
          text('adminSessionsStarted', 'Started'),
          text('adminSessionsState', 'State')
        ]);
        recent.slice(0, 100).forEach(function(session) {
          var row = document.createElement('tr');
          appendCells(recentTable, row, [
            session.email || text('adminValueUnknown', 'Unknown'),
            sessionClientLabel(session),
            session.networkId || text('adminValueUnavailable', 'Unavailable'),
            formatDate(session.createdAt),
            session.active ? text('adminSessionsActiveState', 'Active') : text('adminSessionsInactiveState', 'Inactive')
          ]);
          recentTable.body.appendChild(row);
        });
        results.appendChild(recentTable.table);
      }

      function loadSessionReview(root, options) {
        if (!(root instanceof HTMLElement)) return Promise.resolve();
        hydrateSessionReview(root);
        var force = options && options.force === true;
        if (!force && (root.dataset.adminSessionState === 'loading' || root.dataset.adminSessionState === 'loaded')) return Promise.resolve();
        var status = root.querySelector('[data-admin-session-status]');
        root.dataset.adminSessionState = 'loading';
        setStatus(status, text('adminSessionsLoading', 'Loading admin sessions...'));
        return requestJson('/admin/sessions').then(function(data) {
          root.dataset.adminSessionState = 'loaded';
          renderSessions(root, data);
          setStatus(status, '');
        }).catch(function(error) {
          root.dataset.adminSessionState = 'failed';
          setStatus(status, formatError(error), true);
        });
      }

      function auditQuery(root) {
        var params = new URLSearchParams();
        ['date', 'action', 'email', 'q'].forEach(function(name) {
          var control = root.querySelector('[name="' + name + '"]');
          var value = control ? String(control.value || '').trim() : '';
          if (value) params.set(name, value);
        });
        return params.toString();
      }

      function hydrateAuditReview(root) {
        if (root.querySelector('[data-admin-audit-results]')) return;
        root.replaceChildren();
        var form = createElement('form', 'admin-store-orders__filters');
        [
          ['date', text('adminAuditDate', 'Date'), 'date'],
          ['action', text('adminAuditAction', 'Action'), 'search'],
          ['email', text('adminAuditEmail', 'Admin email'), 'email'],
          ['q', text('adminAuditSearch', 'Search'), 'search']
        ].forEach(function(field) {
          var wrapper = createElement('div', 'admin-store-orders__field');
          var id = 'admin-audit-' + field[0];
          var label = createElement('label', '', field[1]);
          label.setAttribute('for', id);
          var input = document.createElement('input');
          input.id = id;
          input.name = field[0];
          input.type = field[2];
          input.className = 'admin-settings__input';
          input.autocomplete = 'off';
          wrapper.appendChild(label);
          wrapper.appendChild(input);
          form.appendChild(wrapper);
        });
        var apply = createElement('button', 'btn btn--secondary', text('adminAuditApply', 'Apply filters'));
        apply.type = 'submit';
        form.appendChild(apply);
        form.addEventListener('submit', function(event) {
          event.preventDefault();
          loadAuditReview(root);
        });
        var actions = createElement('div', 'admin-store-readiness__actions');
        var exportButton = createElement('button', 'btn btn--secondary', text('adminAuditExport', 'Export filtered CSV'));
        exportButton.type = 'button';
        exportButton.addEventListener('click', function() {
          var query = auditQuery(root);
          downloadAdminCsv({
            path: '/admin/audit.csv' + (query ? '?' + query : ''),
            status: root.querySelector('[data-admin-audit-status]'),
            fallbackFilename: 'admin-audit.csv',
            loadingMessage: text('adminAuditPreparingCsv', 'Preparing audit CSV...'),
            completeMessage: text('adminAuditCsvStarted', 'Audit CSV download started.')
          });
        });
        actions.appendChild(exportButton);
        var status = createElement('p', 'admin-dashboard__status');
        status.dataset.adminAuditStatus = 'true';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        var results = createElement('div', 'admin-audit-review__results');
        results.dataset.adminAuditResults = 'true';
        root.appendChild(form);
        root.appendChild(actions);
        root.appendChild(status);
        root.appendChild(results);
      }

      function renderAuditRows(root, data) {
        var results = root.querySelector('[data-admin-audit-results]');
        if (!results) return;
        results.replaceChildren();
        var rows = Array.isArray(data && data.rows) ? data.rows : [];
        var count = data && data.page && data.page.matched || rows.length;
        results.appendChild(createElement('p', 'admin-app__muted', text(
          'adminAuditSummary',
          '%{count} matching events. Sensitive event payloads are excluded.',
          { count: count }
        )));
        if (!rows.length) {
          results.appendChild(createElement('p', 'admin-app__muted', text('adminAuditNone', 'No matching audit events.')));
          return;
        }
        var reviewTable = createReviewTable([
          text('adminAuditTime', 'Time'),
          text('adminAuditAction', 'Action'),
          text('adminAuditAdmin', 'Admin'),
          text('adminAuditTarget', 'Target'),
          text('adminAuditMutation', 'Mutation')
        ]);
        rows.forEach(function(event) {
          var row = document.createElement('tr');
          appendCells(reviewTable, row, [
            formatDate(event.createdAt),
            event.action || text('adminValueUnknown', 'Unknown'),
            event.adminEmail || text('adminAuditSystem', 'System'),
            event.productId || event.orderToken || event.fileKey || event.itemId || '',
            event.mutation || (Array.isArray(event.changedFields) ? event.changedFields.join(', ') : '')
          ]);
          reviewTable.body.appendChild(row);
        });
        results.appendChild(reviewTable.table);
      }

      function loadAuditReview(root) {
        if (!(root instanceof HTMLElement)) return Promise.resolve();
        hydrateAuditReview(root);
        var status = root.querySelector('[data-admin-audit-status]');
        setStatus(status, text('adminAuditLoading', 'Loading audit events...'));
        var query = auditQuery(root);
        return requestJson('/admin/audit' + (query ? '?' + query : '')).then(function(data) {
          renderAuditRows(root, data);
          setStatus(status, '');
        }).catch(function(error) {
          setStatus(status, formatError(error), true);
        });
      }

      return {
        loadSessionReview: loadSessionReview,
        loadAuditReview: loadAuditReview
      };
    }
  };
})(window);
