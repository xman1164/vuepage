// modules/inspection.js
// 巡勘功能模組

const InspectionModule = (() => {
  // ===== 私有變數 =====
  let ldap = '';
  let currentExgnoList = [];
  let currentRoadList = [];
  let currentDeviceList = [];
  let selectedExgno = '';
  let selectedRoad = '';

  // 回調函數（由 Vue 設定）
  let onShowExgnoDialog = null;
  let onShowRoadDialog = null;
  let onShowDeviceDialog = null;
  let onShowMessage = null;
  let onExecuteDeviceQuery = null; // 新增：執行設備查詢的回調

  // 設備類型配置（對應圖層查詢）
  const deviceQueryConfigs = {
    '1': { // 跨（電桿）
      layerGroup: '電纜圖',
      layerName: '纜電桿(G69)',
      whereField: 'FULLNO_',
      displayName: '電桿'
    },
    '2': { // 人孔
      layerGroup: '管道圖',
      layerName: '管道人孔(G60)',
      whereField: 'FULLNO_',
      displayName: '人孔'
    },
    '3': { // 手孔
      layerGroup: '管道圖',
      layerName: '管道手孔(G61)',
      whereField: 'FULLNO_',
      displayName: '手孔'
    },
    '4': { // 交接箱
      layerGroup: '光纜圖',
      layerName: '戶外終端',
      whereField: 'ACCNOFULL_',
      displayName: '交接箱'
    }
  };

  // ===== 資料處理函數 =====

  /**
   * 解析巡勘道路 API 回應
   * @param {string} jsonString - JSON 字串
   * @returns {Array} 交換局清單，格式：[{exgno, roads: [{road, status}]}]
   */
  function parseInspRoadResponse(jsonString) {
    try {
      const data = JSON.parse(jsonString);

      if (!data.exgnos || !Array.isArray(data.exgnos)) {
        console.error('Invalid response format: missing exgnos array');
        return [];
      }

      const result = [];

      data.exgnos.forEach(exgItem => {
        const exgno = exgItem.exgno;
        let roads = [];

        // 處理 roads 可能是 array 或 object
        if (Array.isArray(exgItem.roads)) {
          roads = exgItem.roads.map(r => ({
            road: r.road,
            status: r.status,
            // 加強判斷：支援字串 "0"/"1" 和數字 0/1
            statusText: (r.status === '1' || r.status === 1) ? '已巡' : '未巡'
          }));
        } else if (typeof exgItem.roads === 'object' && exgItem.roads !== null) {
          // 單一物件
          roads = [{
            road: exgItem.roads.road,
            status: exgItem.roads.status,
            // 加強判斷：支援字串 "0"/"1" 和數字 0/1
            statusText: (exgItem.roads.status === '1' || exgItem.roads.status === 1) ? '已巡' : '未巡'
          }];
        }

        if (roads.length > 0) {
          result.push({ exgno, roads });
        }
      });

      console.log('Parsed InspRoad response:', result);
      return result;

    } catch (error) {
      console.error('Error parsing InspRoad response:', error);
      return [];
    }
  }

  /**
   * 解析設備清單 API 回應
   * @param {string} jsonString - JSON 字串
   * @returns {Array} 設備清單
   */
  function parseInspTargetResponse(jsonString) {
    try {
      const data = JSON.parse(jsonString);

      if (!data.road) {
        console.error('Invalid response format: missing road object');
        return [];
      }

      const roadName = data.road.roadName || '';
      const devices = data.road.devices;
      const result = [];

      // 設備類型對照
      const devTypeMap = {
        '1': '跨',
        '2': '人孔',
        '3': '手孔',
        '4': '交接箱'
      };

      // 處理 devices 可能是 array 或 object
      if (Array.isArray(devices)) {
        devices.forEach(dev => {
          const devType = devTypeMap[dev.devtype] || '未知';
          // 加強判斷：支援字串 "0"/"1" 和數字 0/1
          const status = (dev.status === '1' || dev.status === 1) ? '已巡' : '未巡';

          result.push({
            road: roadName,
            fullNo1: dev.fullNo1,
            fullNo2: dev.fullNo2,
            devtype: dev.devtype,
            devTypeName: devType,
            status: dev.status,
            statusText: status,
            displayText: `${dev.fullNo1} (${status}-${devType})`
          });
        });
      } else if (typeof devices === 'object' && devices !== null) {
        // 單一物件
        const devType = devTypeMap[devices.devtype] || '未知';
        // 加強判斷：支援字串 "0"/"1" 和數字 0/1
        const status = (devices.status === '1' || devices.status === 1) ? '已巡' : '未巡';

        result.push({
          road: roadName,
          fullNo1: devices.fullNo1,
          fullNo2: devices.fullNo2,
          devtype: devices.devtype,
          devTypeName: devType,
          status: devices.status,
          statusText: status,
          displayText: `${devices.fullNo1} (${status}-${devType})`
        });
      }

      console.log('Parsed InspTarget response:', result);
      return result;

    } catch (error) {
      console.error('Error parsing InspTarget response:', error);
      return [];
    }
  }

  /**
   * 取得不重複的交換局清單
   * @param {Array} exgnoData - 交換局資料
   * @returns {Array} 不重複的交換局代碼
   */
  function getUniqueExgnos(exgnoData) {
    const uniqueSet = new Set();
    exgnoData.forEach(item => {
      uniqueSet.add(item.exgno);
    });
    return Array.from(uniqueSet).sort();
  }

  /**
   * 根據交換局代碼取得道路清單
   * @param {Array} exgnoData - 交換局資料
   * @param {string} exgno - 交換局代碼
   * @returns {Array} 道路清單
   */
  function getRoadsByExgno(exgnoData, exgno) {
    const exgItem = exgnoData.find(item => item.exgno === exgno);
    return exgItem ? exgItem.roads : [];
  }

  // ===== API 呼叫函數 =====

  /**
   * 呼叫巡勘道路 API
   * @param {string} staff - 員編
   * @returns {Promise<boolean>} 是否成功
   */
  async function callInspRoadAPI(staff) {
    return new Promise((resolve, reject) => {
      console.log('Calling InspRoad API with staff:', staff);

      if (!window.Android || !window.Android.fetchInspRoad) {
        const error = 'Android.fetchInspRoad not available';
        console.error(error);
        if (onShowMessage) onShowMessage(error);
        reject(error);
        return;
      }

      // 設定回調（Android 會呼叫這個）
      window.onInspRoadResponse = (jsonString) => {
        console.log('Received InspRoad response');

        const parsed = parseInspRoadResponse(jsonString);
        if (parsed.length === 0) {
          if (onShowMessage) onShowMessage('沒有巡勘道路資料');
          resolve(false);
          return;
        }

        currentExgnoList = parsed;

        // 顯示交換局選擇對話框
        const uniqueExgnos = getUniqueExgnos(parsed);
        if (onShowExgnoDialog) {
          onShowExgnoDialog(uniqueExgnos);
        }

        resolve(true);
      };

      window.onInspRoadError = (error) => {
        console.error('InspRoad API error:', error);
        if (onShowMessage) onShowMessage('取得道路清單失敗: ' + error);
        reject(error);
      };

      // 呼叫 Android
      window.Android.fetchInspRoad(staff);
    });
  }

  /**
   * 呼叫設備清單 API
   * @param {string} staff - 員編
   * @param {string} exgno - 交換局代碼
   * @param {string} road - 道路名稱
   * @returns {Promise<boolean>} 是否成功
   */
  async function callInspTargetAPI(staff, exgno, road) {
    return new Promise((resolve, reject) => {
      console.log('Calling InspTarget API:', { staff, exgno, road });

      if (!window.Android || !window.Android.fetchInspTarget) {
        const error = 'Android.fetchInspTarget not available';
        console.error(error);
        if (onShowMessage) onShowMessage(error);
        reject(error);
        return;
      }

      // 設定回調
      window.onInspTargetResponse = (jsonString) => {
        console.log('Received InspTarget response');

        const parsed = parseInspTargetResponse(jsonString);
        if (parsed.length === 0) {
          if (onShowMessage) onShowMessage('沒有設備資料');
          resolve(false);
          return;
        }

        currentDeviceList = parsed;

        // 顯示設備選擇對話框
        if (onShowDeviceDialog) {
          onShowDeviceDialog(parsed);
        }

        resolve(true);
      };

      window.onInspTargetError = (error) => {
        console.error('InspTarget API error:', error);
        if (onShowMessage) onShowMessage('取得設備清單失敗: ' + error);
        reject(error);
      };

      // 呼叫 Android
      window.Android.fetchInspTarget(staff, exgno, road);
    });
  }

  // ===== 公開 API =====
  return {
    /**
     * 初始化模組
     * @param {string} ldapValue - 員編
     * @param {Object} callbacks - 回調函數
     */
    init(ldapValue, callbacks) {
      ldap = ldapValue;

      if (callbacks) {
        onShowExgnoDialog = callbacks.onShowExgnoDialog || null;
        onShowRoadDialog = callbacks.onShowRoadDialog || null;
        onShowDeviceDialog = callbacks.onShowDeviceDialog || null;
        onShowMessage = callbacks.onShowMessage || null;
        onExecuteDeviceQuery = callbacks.onExecuteDeviceQuery || null;
      }

      console.log('InspectionModule initialized with ldap:', ldap);
    },

    /**
     * 開始巡勘流程
     */
    async startInspection() {
      console.log('Starting inspection workflow');

      if (!ldap) {
        if (onShowMessage) onShowMessage('無法取得員編資料');
        return;
      }

      try {
        await callInspRoadAPI(ldap);
      } catch (error) {
        console.error('Failed to start inspection:', error);
      }
    },

    /**
     * 選擇交換局
     * @param {string} exgno - 交換局代碼
     */
    selectExgno(exgno) {
      console.log('Selected exgno:', exgno);
      selectedExgno = exgno;

      // 取得該交換局的道路清單
      const roads = getRoadsByExgno(currentExgnoList, exgno);
      currentRoadList = roads;

      // 顯示道路選擇對話框
      if (onShowRoadDialog) {
        onShowRoadDialog(roads);
      }
    },

    /**
     * 選擇道路
     * @param {string} road - 道路名稱
     */
    async selectRoad(road) {
      console.log('Selected road:', road);
      selectedRoad = road;

      // 呼叫設備清單 API
      try {
        await callInspTargetAPI(ldap, selectedExgno, road);
      } catch (error) {
        console.error('Failed to fetch devices:', error);
      }
    },

    /**
     * 選擇設備
     * @param {Object} device - 設備物件
     */
    selectDevice(device) {
      console.log('Selected device:', device);

      // 提取設備名稱（去除狀態和類型說明）
      // 例如：TPS2A1(已巡-人孔) -> TPS2A1
      const fullText = device.fullNo1 || device.displayText || '';
      const deviceName = fullText.split('(')[0].trim();

      console.log('Device name extracted:', deviceName);
      console.log('Device type:', device.devtype);

      // 取得查詢配置
      const queryConfig = deviceQueryConfigs[device.devtype];

      if (!queryConfig) {
        console.error('Unknown device type:', device.devtype);
        if (onShowMessage) {
          onShowMessage(`未知的設備類型: ${device.devtype}`);
        }
        return;
      }

      // 建立查詢參數
      const queryParams = {
        layerGroup: queryConfig.layerGroup,
        layerName: queryConfig.layerName,
        whereClause: `${queryConfig.whereField}='${deviceName}'`,
        displayName: queryConfig.displayName,
        deviceName: deviceName
      };

      console.log('Query params:', queryParams);

      // 呼叫 Vue 的查詢功能
      if (onExecuteDeviceQuery) {
        onExecuteDeviceQuery(queryParams);
      } else {
        console.error('onExecuteDeviceQuery callback not set');
        if (onShowMessage) {
          onShowMessage('設備查詢功能未就緒');
        }
      }
    },

    /**
     * 取得當前資料
     */
    getCurrentData() {
      return {
        exgnoList: currentExgnoList,
        roadList: currentRoadList,
        deviceList: currentDeviceList,
        selectedExgno,
        selectedRoad
      };
    }
  };
})();

// 確保在全域可用
if (typeof window !== 'undefined') {
  window.InspectionModule = InspectionModule;
}