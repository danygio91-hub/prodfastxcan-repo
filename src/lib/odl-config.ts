
export interface ColumnConfig {
  id: string;
  label: string;
  width: string;
  field: string;
  visible: boolean;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
}

export interface HeaderColumnConfig extends ODLConfigColumn {
    field: 'reparto' | 'dataOdl' | 'ordinePf' | 'numeroOdl';
}

interface ODLConfigColumn {
    id: string;
    label: string;
    width: string;
    visible: boolean;
}

export interface ODLConfig {
  header: {
    title: string;
    logoUrl: string;
    logoBase64?: string;
    logoHeight: number;
    qrSize: number;
    showRevInfo: boolean;
    revText: string;
    columns: HeaderColumnConfig[];
  };
  layout: {
    showDrawingArea: boolean;
    drawingAreaText: string;
    showEstimatedTimes: boolean;
    splitByCategoryThreshold: number;
    cellPadding: number;
    textAlign: 'left' | 'center' | 'right';
    verticalAlign: 'top' | 'middle' | 'bottom';
  };
  typography: {
    baseFontSize: number;
    titleFontSize: number;
    headerFontSize: number;
  };
  colors: {
    primary: string; // Title and highlights
    headerBg: string; // Second/third row of header
    headerText: string;
    tableHeaderBg: string;
    tableHeaderText: string;
    footerBg: string;
    footerText: string;
    drawingAreaBg: string;
    drawingAreaText: string;
    bgValueGreen: string;
    bgValueYellow: string;
    bgTreccia: string;
    bgTubi: string;
    bgGuaina: string;
    border: string;
  };
  columns: {
    treccia: ColumnConfig[];
    tubi: ColumnConfig[];
    guaina: ColumnConfig[];
  };
}

export const DEFAULT_ODL_CONFIG: ODLConfig = {
  header: {
    title: "SCHEDA DI LAVORAZIONE",
    logoUrl: "/logo.png",
    logoHeight: 40,
    qrSize: 80,
    showRevInfo: true,
    revText: "MOD. 800_5_02 REV.0 del 08/05/2024",
    columns: [
        { id: 'h1', label: 'REPARTO', width: '20%', field: 'reparto', visible: true },
        { id: 'h2', label: 'DATA ODL', width: '20%', field: 'dataOdl', visible: true },
        { id: 'h3', label: 'NUMERO ORDINE PF', width: '30%', field: 'ordinePf', visible: true },
        { id: 'h4', label: 'N° ODL', width: '30%', field: 'numeroOdl', visible: true },
    ]
  },
  layout: {
    showDrawingArea: true,
    drawingAreaText: "SPAZIO PER DISEGNO TECNICO / NOTE AGGIUNTIVE",
    showEstimatedTimes: true,
    splitByCategoryThreshold: 12,
    cellPadding: 4,
    textAlign: 'center',
    verticalAlign: 'middle',
  },
  typography: {
    baseFontSize: 8,
    titleFontSize: 16,
    headerFontSize: 7,
  },
  colors: {
    primary: "#337ab7",
    headerBg: "#f3f4f6",
    headerText: "#555555",
    tableHeaderBg: "#f3f4f6",
    tableHeaderText: "#000000",
    footerBg: "#fff3e0",
    footerText: "#000000",
    drawingAreaBg: "#ffffff",
    drawingAreaText: "#cccccc",
    bgValueGreen: "#c8e6c9",
    bgValueYellow: "#fff9c4",
    bgTreccia: "#e8f5e9",
    bgTubi: "#f5f5f5",
    bgGuaina: "#e1f5fe",
    border: "#000000",
  },
  columns: {
    treccia: [
      { id: '1', label: 'TRECCIA/CORDA', width: '20%', field: 'codice', visible: true },
      { id: '2', label: 'L TAGLIO mm', width: '15%', field: 'lunghezzaTaglio', visible: true },
      { id: '3', label: 'QT', width: '10%', field: 'quantita', visible: true },
      { id: '4', label: 'QT (kg)', width: '10%', field: 'pesoTotale', visible: true },
      { id: '5', label: 'Verifica misura mm', width: '15%', field: 'placeholder', visible: true },
      { id: '6', label: 'Completato', width: '10%', field: 'checkbox', visible: true },
      { id: '7', label: 'Tempo Previsto (hh:mm)', width: '20%', field: 'tempoPrevisto', visible: true },
    ],
    tubi: [
      { id: '1', label: 'CODICE TUBI', width: '20%', field: 'codice', visible: true },
      { id: '2', label: 'QT (n°)', width: '15%', field: 'quantita', visible: true },
      { id: '3', label: 'QT (kg)', width: '15%', field: 'pesoTotale', visible: true },
      { id: '4', label: 'Verifica misure', width: '15%', field: 'placeholder', visible: true },
      { id: '5', label: 'Prelevato da mag', width: '15%', field: 'checkbox', visible: true },
      { id: '6', label: 'Tempo Previsto (hh:mm)', width: '20%', field: 'tempoPrevisto', visible: true },
    ],
    guaina: [
      { id: '1', label: 'GUAINA', width: '20%', field: 'codice', visible: true },
      { id: '2', label: 'L TAGLIO mm', width: '15%', field: 'lunghezzaTaglio', visible: true },
      { id: '3', label: 'QT', width: '10%', field: 'quantita', visible: true },
      { id: '4', label: 'Mt. Guaina', width: '10%', field: 'metriTotali', visible: true },
      { id: '5', label: 'Verifica misura mm', width: '15%', field: 'placeholder', visible: true },
      { id: '6', label: 'Completato', width: '10%', field: 'checkbox', visible: true },
      { id: '7', label: 'Tempo Previsto (hh:mm)', width: '20%', field: 'tempoPrevisto', visible: true },
    ]
  }
};
