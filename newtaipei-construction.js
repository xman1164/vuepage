/**
 * 新北市今日施工位置模組
 */

const NewTaipeiConstructionModule = (() => {
  
  const API_URL = 'https://npnco.blob.core.windows.net/blobfs/Appwork.json';
  
  let onShowMessage = null;
  let onConstructionDataLoaded = null;
  
  /**
   * 初始化
   */
  function init(callbacks) {
    onShowMessage = callbacks.onShowMessage || null;
    onConstructionDataLoaded = callbacks.onConstructionDataLoaded || null;
    
    console.log('新北市今日施工位置模組已初始化');
  }
  
  /**
   * 載入施工資料
   */
  async function loadConstructionData() {
    console.log('========================================');
    console.log('開始載入新北市今日施工資料');
    console.log('API URL:', API_URL);
    console.log('========================================');
    
    if (onShowMessage) {
      onShowMessage('載入施工資料中...');
    }
    
    try {
      const response = await fetch(API_URL);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      console.log('✓ JSON 載入成功');
      console.log('資料結構:', Object.keys(data));
      
      if (!data.features || !Array.isArray(data.features)) {
        throw new Error('JSON 格式錯誤：缺少 features 陣列');
      }
      
      console.log('✓ 找到', data.features.length, '筆施工資料');
      console.log('========================================');
      
      // 解析每一筆施工資料
      const constructions = data.features.map((feature, index) => {
        console.log(`--- 施工資料 #${index + 1} ---`);
        
        // 座標
        const coordinates = feature.geometry?.coordinates || [];
        const x = coordinates[0] || 0;
        const y = coordinates[1] || 0;
        console.log('座標:', x, y);
        
        // 屬性
        const props = feature.properties || {};
        console.log('路證編號:', props.Ac_no);
        console.log('施工單位:', props.App_Name);
        console.log('行政區:', props.C_Name);
        console.log('地點:', props.Addr);
        console.log('施工起始:', props.Cb_Da);
        console.log('施工完成:', props.Ce_Da);
        console.log('施工時間:', props.Co_Ti);
        console.log('施工廠商:', props.Tc_Na);
        console.log('廠商窗口:', props.Tc_Ma);
        console.log('廠商窗口電話:', props.Tc_Tl);
        console.log('現場人員:', props.Tc_Ma3);
        console.log('現場人員電話:', props.Tc_Tl3);
        console.log('施工目的:', props.NPurp);
        console.log('工項:', props.WItem);
        console.log('');
        
        return {
          coordinates: { x, y },
          acNo: props.Ac_no || '',
          appName: props.App_Name || '',
          cName: props.C_Name || '',
          addr: props.Addr || '',
          cbDa: props.Cb_Da || '',
          ceDa: props.Ce_Da || '',
          coTi: props.Co_Ti || '',
          tcNa: props.Tc_Na || '',
          tcMa: props.Tc_Ma || '',
          tcTl: props.Tc_Tl || '',
          tcMa3: props.Tc_Ma3 || '',
          tcTl3: props.Tc_Tl3 || '',
          nPurp: props.NPurp || '',
          wItem: props.WItem || ''
        };
      });
      
      console.log('========================================');
      console.log('✓ 資料解析完成，共', constructions.length, '筆');
      console.log('========================================');
      
      if (onShowMessage) {
        onShowMessage(`載入完成：${constructions.length} 筆施工資料`);
      }
      
      if (onConstructionDataLoaded) {
        onConstructionDataLoaded(constructions);
      }
      
      return constructions;
      
    } catch (error) {
      console.error('========================================');
      console.error('❌ 載入施工資料失敗');
      console.error('錯誤:', error.message);
      console.error('========================================');
      
      if (onShowMessage) {
        onShowMessage('載入施工資料失敗: ' + error.message);
      }
      
      throw error;
    }
  }
  
  // 公開 API
  return {
    init,
    loadConstructionData
  };
  
})();

// 導出模組
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NewTaipeiConstructionModule;
}
