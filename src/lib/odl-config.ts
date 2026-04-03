
export interface ColumnConfig {
  id: string;
  label: string;
  width: string;
  field: string;
  visible: boolean;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  fontSize?: number;
}

export interface HeaderColumnConfig extends ODLConfigColumn {
    field: 'reparto' | 'dataOdl' | 'ordinePf' | 'numeroOdl';
    fontSize?: number;
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
    logoColumnWidth?: string;
    logoBg?: string;
    titleHeight?: string;
    titleBg?: string;
    qrColumnWidth?: string;
    qrSize: number;
    qrTitleHeight?: string;
    qrTitleBg?: string;
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
    drawingAreaHeight?: string;
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
  info: {
    labelWidth: string;
    valueWidth: string;
    fontSize: number;
    columns: { id: string; label: string; field: string; visible: boolean; colorKey?: string }[];
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
    logoColumnWidth: "23.5%",
    logoBg: "#ffffff",
    titleHeight: "12mm",
    titleBg: "#337ab7",
    qrColumnWidth: "15%",
    qrSize: 80,
    qrTitleHeight: "6mm",
    qrTitleBg: "#337ab7",
    showRevInfo: true,
    revText: "MOD. 800_5_02 REV.0 del 08/05/2024",
    columns: [
        { id: 'h1', label: 'REPARTO', width: '20%', field: 'reparto', visible: true },
        { id: 'h2', label: 'DATA ODL', width: '20%', field: 'dataOdl', visible: true },
        { id: 'h3', label: 'NUMERO ORDINE PF', width: '30%', field: 'ordinePf', visible: true },
        { id: 'h4', label: 'N° ODL', width: '30%', field: 'numeroOdl', visible: true },
    ]
  },
  info: {
    labelWidth: "15%",
    valueWidth: "25%",
    fontSize: 8,
    columns: [
        { id: 'i1', label: 'CLIENTE', field: 'cliente', visible: true },
        { id: 'i2', label: 'CODICE ARTICOLO', field: 'details', visible: true, colorKey: 'bgValueGreen' },
        { id: 'i3', label: 'QT', field: 'qta', visible: true, colorKey: 'bgValueGreen' },
        { id: 'i4', label: 'DATA FINE PREPARAZIONE MATERIALE', field: 'dataFinePreparazione', visible: true, colorKey: 'bgValueYellow' },
        { id: 'i5', label: 'DATA CONSEGNA FINALE', field: 'dataConsegnaFinale', visible: true, colorKey: 'bgValueYellow' },
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
    drawingAreaHeight: "40mm",
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
