import UIKit
import WebKit
import Capacitor

// LG01 · piloto de Liquid Glass nativo (brand book, familias "Navegación" y
// "Botones flotantes"). Decisiones de Pedro del 26-sep-2026:
//   · Regreso de 44 pt en vidrio sobre la foto de la ficha, y con el mismo
//     vidrio el "me gusta" y los tres puntos.
//   · Los tres respetan el header al cargar y, al hacer scroll, se quedan
//     FIJOS en esa posición en vez de irse con la foto.
//   · Favorito y opciones juntos en UNA cápsula; el regreso, en su círculo.
//   · Barra inferior: cápsula charcoal compacta y centrada, icono sobre
//     texto, Vender como pestaña más en medio, activo en blanco (sin verde)
//     y una burbuja de vidrio que se desliza entre pestañas (arrastrable).
//
// REPARTO DE RESPONSABILIDADES — la regla que no hay que romper:
//   · La WEB sigue siendo la dueña de la navegación. Decide qué pestañas hay,
//     cuál está activa, cuándo desaparece la barra (chat, /vender, ficha…),
//     el badge de no leídos, a dónde lleva cada regreso (resolver S01 en
//     /vender, fallback propio en la ficha), el muro de sesión del favorito
//     y el menú de opciones.
//   · Lo NATIVO es solo la piel: dibuja esos controles con el material del
//     sistema y, al tocarlos, pulsa el control web equivalente, que queda
//     oculto pero vivo. Así se conservan háptica, restauración de scroll,
//     aria-current y las reglas de retorno sin duplicar lógica en Swift.
//
// El contrato con la web es el DOM que ya existe: la <nav> con
// aria-label="Navegación principal", los ids nav-*, y en la ficha el botón de
// regreso, el favorito (aria-pressed) y "Mas opciones". Si la web cambia ese
// marcado, el script deja de encontrarlos y lo nativo no se muestra: la web
// vuelve a verse tal cual. Falla hacia lo seguro.

final class VicinoBridgeViewController: CAPBridgeViewController {
    private let cromo = CromoNativo()

    // Se instala sobre el userContentController del WKWebView YA creado y no
    // en webViewConfiguration(for:): lo instalado ahí no llegaba a la página
    // (comprobado en el Simulator el 26-sep). El user script cubre las cargas
    // completas siguientes; la primera, que ya está en curso, se cubre
    // inyectando el mismo script al terminar de cargar.
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView else { return }
        cromo.instalar(en: webView.configuration.userContentController)
        cromo.montar(sobre: webView)
    }
}

// MARK: - Estado que reporta la web

private struct EstadoWeb: Decodable, Equatable {
    struct Pestana: Decodable, Equatable {
        let id: String
        let titulo: String
        let activa: Bool
        let central: Bool
        let insignia: String?
    }
    /// Botón flotante de la ficha. x/y/ancho/alto: posición del control web
    /// en la ventana TAL COMO QUEDA FIJADO (no cambia con el scroll).
    struct Flotante: Decodable, Equatable {
        let tipo: String          // "regreso" | "favorito" | "opciones"
        let x: CGFloat, y: CGFloat, ancho: CGFloat, alto: CGFloat
        let activo: Bool          // favorito marcado
    }
    /// Botón de acción del header (Rankings, Notificaciones, Menú, Admin).
    /// Posición en la ventana; el header es sticky, así que no cambia con
    /// el scroll.
    struct Accion: Decodable, Equatable {
        let etiqueta: String
        let x: CGFloat, y: CGFloat, ancho: CGFloat, alto: CGFloat
        let aviso: Bool           // punto rojo de no leídas
    }
    let pestanas: [Pestana]?      // nil = la web no muestra barra en esta ruta
    let flotantes: [Flotante]
    let cabecera: [Accion]
    let oscuro: Bool
    /// Hay un modal, drawer o sheet abierto en la web. Lo nativo va SIEMPRE
    /// por encima del WebView, así que se aparta para no tapar el modal (la
    /// barra web lo resolvía con z-index; aquí no hay z-index que valga).
    let modal: Bool

    static let vacio = EstadoWeb(pestanas: nil, flotantes: [], cabecera: [], oscuro: false, modal: false)
}

/// Contenido del menú de cuenta tal como lo pinta la web (drawer abierto y
/// oculto). Lo nativo lo muestra como hoja de iOS.
private struct MenuWeb: Decodable {
    struct Perfil: Decodable { let nombre: String; let usuario: String?; let foto: String? }
    struct Opcion: Decodable { let titulo: String; let href: String? ; let tema: Bool?; let activo: Bool? }
    struct Seccion: Decodable { let titulo: String; let opciones: [Opcion] }
    let titulo: String
    let perfil: Perfil?
    let secciones: [Seccion]
}
private struct MensajeMenu: Decodable { let menu: MenuWeb }

// MARK: - Cromo nativo

final class CromoNativo: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private var estado: EstadoWeb?
    private var observadorCarga: NSKeyValueObservation?

    // Barra inferior: cápsula compacta y centrada (proporciones de la
    // referencia de Pedro, 26-sep: tab bar de Luma en iOS 26), en vidrio
    // CLARO y transparente que sigue el tema de la app. Sin verde.
    private static let altoBarra: CGFloat = 62
    private static let anchoPestana: CGFloat = 68
    private let barra = UIView()
    private let pildora = CromoNativo.vidrio(esquina: altoBarra / 2)
    private let filaPestanas = UIStackView()
    private let indicador = UIView()
    /// Lente de vidrio transparente que aparece al arrastrar: más grande que
    /// la barra, por encima de los iconos (foto 1 de la referencia).
    private let lente = CromoNativo.lenteDeVidrio()
    private var anchoBarra: NSLayoutConstraint?
    private var celdas: [(id: String, vista: UIView)] = []
    private var pestanasPintadas: [EstadoWeb.Pestana]?? = .none
    private var idActiva: String?
    private var arrastrando = false
    private var idBajoDedo: String?
    private let seleccion = UISelectionFeedbackGenerator()

    // Ficha de producto: regreso en un círculo; favorito y opciones JUNTOS en
    // una sola cápsula, como los dos botones de la referencia.
    private let regreso = CromoNativo.vidrio(esquina: 22)
    private let grupo = CromoNativo.vidrio(esquina: 22)
    private let filaGrupo = UIStackView()
    private var botones: [String: UIButton] = [:]

    // Header: sus botones de acción juntos en una sola cápsula, como el
    // "+ / lupa" de la referencia.
    private let cabecera = CromoNativo.vidrio(esquina: 22)
    private let filaCabecera = UIStackView()
    private var etiquetasCabecera: [String] = []

    // MARK: Instalación

    func instalar(en controller: WKUserContentController) {
        controller.addUserScript(WKUserScript(
            source: CromoNativo.puenteJS,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))
        // WKUserContentController retiene al handler: se pasa un proxy débil
        // para no crear un ciclo con el controlador de la vista.
        controller.add(ProxyDebil(self), name: "vicinoCromo")
    }

    func montar(sobre webView: WKWebView) {
        self.webView = webView
        observadorCarga = webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] vista, _ in
            guard !vista.isLoading else { return }
            guard let host = vista.url?.host, CromoNativo.hostsPropios.contains(host) else {
                // Página ajena (login de Google, Supabase): nada nativo encima.
                self?.estado = .vacio
                self?.aplicar(.vacio)
                return
            }
            // Idempotente: el script sale si ya está instalado en la página.
            vista.evaluateJavaScript(CromoNativo.puenteJS)
        }
        montarBarra(en: webView)
        montarFlotantes(en: webView)
        montarCabecera(en: webView)
    }

    private func montarCabecera(en webView: WKWebView) {
        cabecera.isHidden = true
        cabecera.alpha = 0
        filaCabecera.axis = .horizontal
        filaCabecera.distribution = .fillEqually
        filaCabecera.frame = cabecera.bounds
        filaCabecera.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cabecera.contentView.addSubview(filaCabecera)
        webView.addSubview(cabecera)
    }

    private func montarBarra(en webView: WKWebView) {
        barra.translatesAutoresizingMaskIntoConstraints = false
        barra.isHidden = true
        barra.alpha = 0
        webView.addSubview(barra)

        // Burbuja de vidrio más clara detrás de la pestaña activa (foto 2 de
        // la referencia): casi toda la altura de la barra, con un canto de
        // luz. Va DETRÁS de los iconos; es una sola pieza que se desliza, no
        // un fondo por pestaña.
        indicador.backgroundColor = UIColor { rasgos in
            rasgos.userInterfaceStyle == .dark
                ? UIColor.white.withAlphaComponent(0.16)
                : UIColor.black.withAlphaComponent(0.06)
        }
        indicador.layer.borderWidth = 0.5
        indicador.layer.cornerCurve = .continuous
        indicador.isUserInteractionEnabled = false
        indicador.alpha = 0
        pildora.contentView.addSubview(indicador)

        filaPestanas.axis = .horizontal
        filaPestanas.distribution = .fillEqually
        filaPestanas.alignment = .fill
        filaPestanas.translatesAutoresizingMaskIntoConstraints = false
        pildora.contentView.addSubview(filaPestanas)
        pildora.translatesAutoresizingMaskIntoConstraints = false
        barra.addSubview(pildora)
        // La lente va FUERA de la cápsula (que recorta) para poder sobresalir.
        lente.isHidden = true
        lente.isUserInteractionEnabled = false
        barra.addSubview(lente)

        // Arrastrar sobre la cápsula mueve la burbuja 1:1 con el dedo; al
        // soltar, se asienta en la pestaña más cercana y navega a ella.
        pildora.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(arrastrarBurbuja(_:))))

        let ancho = barra.widthAnchor.constraint(equalToConstant: CromoNativo.anchoPestana * 4 + 12)
        ancho.priority = .defaultHigh
        anchoBarra = ancho
        // Separada del borde inferior. Con home indicator queda justo encima
        // de él (dentro del área segura, como las tab bars de iOS 26); sin él,
        // a 12 pt del borde. La primera regla es obligatoria y gana.
        let sobreIndicador = barra.bottomAnchor.constraint(equalTo: webView.safeAreaLayoutGuide.bottomAnchor, constant: 8)
        sobreIndicador.priority = .defaultHigh
        NSLayoutConstraint.activate([
            barra.bottomAnchor.constraint(lessThanOrEqualTo: webView.bottomAnchor, constant: -12),
            sobreIndicador,
            barra.centerXAnchor.constraint(equalTo: webView.centerXAnchor),
            // Nunca toca los bordes laterales, en ningún ancho de pantalla.
            barra.leadingAnchor.constraint(greaterThanOrEqualTo: webView.leadingAnchor, constant: 16),
            ancho,
            barra.heightAnchor.constraint(equalToConstant: CromoNativo.altoBarra),

            pildora.leadingAnchor.constraint(equalTo: barra.leadingAnchor),
            pildora.trailingAnchor.constraint(equalTo: barra.trailingAnchor),
            pildora.topAnchor.constraint(equalTo: barra.topAnchor),
            pildora.bottomAnchor.constraint(equalTo: barra.bottomAnchor),

            filaPestanas.leadingAnchor.constraint(equalTo: pildora.contentView.leadingAnchor, constant: 6),
            filaPestanas.trailingAnchor.constraint(equalTo: pildora.contentView.trailingAnchor, constant: -6),
            filaPestanas.topAnchor.constraint(equalTo: pildora.contentView.topAnchor, constant: 5),
            filaPestanas.bottomAnchor.constraint(equalTo: pildora.contentView.bottomAnchor, constant: -5),
        ])
    }

    private func montarFlotantes(en webView: WKWebView) {
        for vista in [regreso, grupo] {
            vista.isHidden = true
            vista.alpha = 0
            webView.addSubview(vista)
        }
        // 44 x 44 pt: mínimo táctil de Apple.
        regreso.frame = CGRect(x: 0, y: 0, width: 44, height: 44)
        let volver = boton(simbolo: "chevron.left", etiqueta: "Volver", tipo: "regreso")
        volver.frame = regreso.bounds
        volver.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        regreso.contentView.addSubview(volver)

        filaGrupo.axis = .horizontal
        filaGrupo.distribution = .fillEqually
        filaGrupo.frame = grupo.bounds
        filaGrupo.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        grupo.contentView.addSubview(filaGrupo)
        filaGrupo.addArrangedSubview(boton(simbolo: "heart", etiqueta: "Agregar a favoritos", tipo: "favorito"))
        filaGrupo.addArrangedSubview(boton(simbolo: "ellipsis", etiqueta: "Más opciones", tipo: "opciones"))
    }

    // MARK: Web → nativo

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "vicinoCromo",
              message.frameInfo.isMainFrame,
              CromoNativo.hostsPropios.contains(message.frameInfo.securityOrigin.host),
              let texto = message.body as? String,
              let datos = texto.data(using: .utf8) else { return }
        if let m = try? JSONDecoder().decode(MensajeMenu.self, from: datos) {
            presentarMenu(m.menu)
            return
        }
        guard let nuevo = try? JSONDecoder().decode(EstadoWeb.self, from: datos),
              nuevo != estado else { return }
        estado = nuevo
        aplicar(nuevo)
    }

    private func aplicar(_ e: EstadoWeb) {
        // Todo sigue el tema de la web (next-themes), no el del sistema: el
        // vidrio tiene que combinar con la página que tiene debajo.
        let estilo: UIUserInterfaceStyle = e.oscuro ? .dark : .light
        barra.overrideUserInterfaceStyle = estilo
        // El canto de luz de la burbuja es un CGColor: no se adapta solo.
        indicador.layer.borderColor = UIColor.white.withAlphaComponent(e.oscuro ? 0.22 : 0.7).cgColor
        regreso.overrideUserInterfaceStyle = estilo
        grupo.overrideUserInterfaceStyle = estilo
        cabecera.overrideUserInterfaceStyle = estilo

        if e.pestanas != pestanasPintadas {
            pestanasPintadas = e.pestanas
            pintarPestanas(e.pestanas ?? [])
        }
        fundir(barra, visible: !e.modal && !(e.pestanas ?? []).isEmpty)
        aplicarFlotantes(e.modal ? [] : e.flotantes)
        aplicarCabecera(e.modal ? [] : e.cabecera)
    }

    private static let simbolosCabecera: [String: String] = [
        "Panel de admin": "sparkles",
        "Rankings": "trophy",
        "Notificaciones": "bell",
        "Menú de cuenta": "line.3.horizontal",
    ]

    private func aplicarCabecera(_ acciones: [EstadoWeb.Accion]) {
        guard let primera = acciones.first, let ultima = acciones.last else {
            fundir(cabecera, visible: false)
            return
        }
        let etiquetas = acciones.map { $0.etiqueta }
        if etiquetas != etiquetasCabecera {
            etiquetasCabecera = etiquetas
            filaCabecera.arrangedSubviews.forEach { $0.removeFromSuperview() }
            for (indice, accion) in acciones.enumerated() {
                let b = UIButton(type: .system)
                let conf = UIImage.SymbolConfiguration(pointSize: 17, weight: .medium)
                b.setImage(UIImage(systemName: CromoNativo.simbolosCabecera[accion.etiqueta] ?? "circle", withConfiguration: conf), for: .normal)
                b.tintColor = .label
                b.accessibilityLabel = accion.etiqueta
                b.addAction(UIAction { [weak self] _ in self?.pulsarCabecera(indice) }, for: .touchUpInside)
                // Se marca al presionar (pedido de Pedro, 26-sep), salvo
                // Admin, que se queda como está.
                if accion.etiqueta != "Panel de admin" { animarAlPresionar(b) }
                let punto = UIView()
                punto.backgroundColor = .systemRed
                punto.layer.cornerRadius = 3.5
                punto.isHidden = true
                punto.isUserInteractionEnabled = false
                punto.tag = 7
                punto.translatesAutoresizingMaskIntoConstraints = false
                b.addSubview(punto)
                NSLayoutConstraint.activate([
                    punto.widthAnchor.constraint(equalToConstant: 7),
                    punto.heightAnchor.constraint(equalToConstant: 7),
                    punto.centerXAnchor.constraint(equalTo: b.centerXAnchor, constant: 8),
                    punto.centerYAnchor.constraint(equalTo: b.centerYAnchor, constant: -8),
                ])
                filaCabecera.addArrangedSubview(b)
            }
        }
        for (b, accion) in zip(filaCabecera.arrangedSubviews, acciones) {
            b.viewWithTag(7)?.isHidden = !accion.aviso
            b.accessibilityValue = accion.aviso ? "Sin leer" : nil
        }
        // Conserva el borde derecho del último botón web y crece hacia la
        // izquierda; 46 pt por botón, 44 de alto.
        let ancho = CGFloat(acciones.count) * 46
        let derecha = ultima.x + ultima.ancho / 2 + 22
        cabecera.frame = CGRect(x: derecha - ancho, y: primera.y + primera.alto / 2 - 22, width: ancho, height: 44)
        fundir(cabecera, visible: true)
    }

    private func aplicarFlotantes(_ lista: [EstadoWeb.Flotante]) {
        let porTipo = Dictionary(lista.map { ($0.tipo, $0) }, uniquingKeysWith: { a, _ in a })

        if let r = porTipo["regreso"] {
            // Centrado sobre el control web al que sustituye.
            regreso.center = CGPoint(x: r.x + r.ancho / 2, y: r.y + r.alto / 2)
            fundir(regreso, visible: true)
        } else {
            fundir(regreso, visible: false)
        }

        let enGrupo = ["favorito", "opciones"].compactMap { porTipo[$0] }
        botones["favorito"]?.isHidden = porTipo["favorito"] == nil
        botones["opciones"]?.isHidden = porTipo["opciones"] == nil
        guard let ultimo = enGrupo.last else {
            fundir(grupo, visible: false)
            return
        }
        // La cápsula conserva el borde derecho del último botón web (en
        // espejo con el regreso de la izquierda) y crece hacia la izquierda.
        let ancho: CGFloat = enGrupo.count == 2 ? 92 : 44
        let derecha = ultimo.x + ultimo.ancho / 2 + 22
        grupo.frame = CGRect(x: derecha - ancho, y: ultimo.y + ultimo.alto / 2 - 22, width: ancho, height: 44)

        if let f = porTipo["favorito"], let icono = botones["favorito"] {
            let conf = UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)
            icono.setImage(UIImage(systemName: f.activo ? "heart.fill" : "heart", withConfiguration: conf), for: .normal)
            icono.tintColor = f.activo ? .systemRed : .label
            icono.accessibilityLabel = f.activo ? "Quitar de favoritos" : "Agregar a favoritos"
            icono.accessibilityTraits = f.activo ? [.button, .selected] : .button
        }
        fundir(grupo, visible: true)
    }

    // MARK: Barra: pestañas y burbuja

    private func pintarPestanas(_ pestanas: [EstadoWeb.Pestana]) {
        // Orden de la web: la central (Vender) va EN MEDIO de las laterales,
        // como una pestaña más, con el mismo estilo.
        var orden = pestanas.filter { !$0.central }
        if let central = pestanas.first(where: { $0.central }) {
            orden.insert(central, at: (orden.count + 1) / 2)
        }
        filaPestanas.arrangedSubviews.forEach { $0.removeFromSuperview() }
        celdas = orden.map { p in
            let vista = celda(para: p)
            filaPestanas.addArrangedSubview(vista)
            return (p.id, vista)
        }
        anchoBarra?.constant = CromoNativo.anchoPestana * CGFloat(max(orden.count, 1)) + 12

        // La burbuja se desliza desde la pestaña anterior a la nueva. Si no
        // había ninguna (primera carga o sin barra), aparece ya en su sitio.
        let nueva = orden.first(where: { $0.activa })?.id
        let habiaAnterior = idActiva != nil && indicador.alpha > 0
        idActiva = nueva
        barra.superview?.layoutIfNeeded()
        guard !arrastrando else { return }
        moverIndicador(a: nueva, animado: habiaAnterior)
    }

    /// En reposo: el ancho de la pestaña y la altura de la barra menos 3 pt
    /// por lado.
    private func marcoIndicador(para id: String?) -> CGRect? {
        guard let id, let vista = celdas.first(where: { $0.id == id })?.vista else { return nil }
        let celda = vista.convert(vista.bounds, to: pildora.contentView)
        return CGRect(x: celda.minX, y: 3, width: celda.width, height: pildora.contentView.bounds.height - 6)
    }

    /// Al arrastrar: la lente sobresale 9 pt por arriba y por abajo, y 9 pt
    /// a los lados, centrada en x.
    private func marcoLente(centroX: CGFloat) -> CGRect {
        let reposo = indicador.bounds
        let alto = CromoNativo.altoBarra + 18
        let ancho = reposo.width + 18
        return CGRect(x: centroX - ancho / 2, y: -9, width: ancho, height: alto)
    }

    private func moverIndicador(a id: String?, animado: Bool) {
        guard let destino = marcoIndicador(para: id) else {
            UIView.animate(withDuration: 0.15) { self.indicador.alpha = 0 }
            return
        }
        indicador.layer.cornerRadius = destino.height / 2
        guard animado, !UIAccessibility.isReduceMotionEnabled else {
            indicador.frame = destino
            indicador.alpha = 1
            return
        }
        // Resorte con un poco de rebote: la burbuja "viaja" hasta la pestaña.
        UIView.animate(withDuration: 0.45, delay: 0, usingSpringWithDamping: 0.78,
                       initialSpringVelocity: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.indicador.frame = destino
            self.indicador.alpha = 1
        }
    }

    @objc private func arrastrarBurbuja(_ gesto: UIPanGestureRecognizer) {
        let x = gesto.location(in: pildora.contentView).x
        let mitad = indicador.bounds.width / 2
        let limite = pildora.contentView.bounds.insetBy(dx: 6 + mitad, dy: 0)
        let centroX = min(max(x, limite.minX), limite.maxX)
        let reducir = UIAccessibility.isReduceMotionEnabled
        switch gesto.state {
        case .began:
            arrastrando = true
            seleccion.prepare()
            idBajoDedo = idActiva
            // La burbuja "se levanta": sale de la barra convertida en lente,
            // creciendo desde su tamaño de reposo.
            lente.frame = pildora.contentView.convert(indicador.frame, to: barra)
            lente.layer.cornerRadius = lente.bounds.height / 2
            lente.isHidden = false
            lente.alpha = 0
            UIView.animate(withDuration: reducir ? 0 : 0.28, delay: 0, usingSpringWithDamping: 0.8,
                           initialSpringVelocity: 0, options: [.beginFromCurrentState]) {
                self.lente.frame = self.marcoLente(centroX: centroX)
                self.lente.layer.cornerRadius = self.lente.bounds.height / 2
                self.lente.alpha = 1
                self.indicador.alpha = 0
            }
            indicador.center.x = centroX
        case .changed:
            // 1:1 con el dedo, sin salirse de la cápsula.
            indicador.center.x = centroX
            lente.center.x = centroX
            let cercana = celdaMasCercana(a: centroX)
            if cercana != idBajoDedo {
                idBajoDedo = cercana
                seleccion.selectionChanged()
            }
        case .ended, .cancelled, .failed:
            arrastrando = false
            // Se proyecta la inercia del gesto: un deslizamiento rápido llega
            // más lejos de donde se soltó el dedo.
            let proyectado = centroX + gesto.velocity(in: pildora.contentView).x * 0.08
            let destino = gesto.state == .ended ? celdaMasCercana(a: proyectado) : idActiva
            // La lente se asienta en la pestaña y vuelve a ser burbuja.
            if let reposo = marcoIndicador(para: destino) {
                indicador.frame = reposo
                indicador.layer.cornerRadius = reposo.height / 2
                UIView.animate(withDuration: reducir ? 0 : 0.4, delay: 0, usingSpringWithDamping: 0.82,
                               initialSpringVelocity: 0, options: [.beginFromCurrentState]) {
                    self.lente.frame = self.pildora.contentView.convert(reposo, to: self.barra)
                    self.lente.layer.cornerRadius = reposo.height / 2
                } completion: { _ in
                    UIView.animate(withDuration: reducir ? 0 : 0.15) {
                        self.indicador.alpha = 1
                        self.lente.alpha = 0
                    } completion: { _ in
                        if !self.arrastrando { self.lente.isHidden = true }
                    }
                }
            } else {
                lente.isHidden = true
            }
            if let destino, destino != idActiva { pulsarWeb(id: destino) }
        default:
            break
        }
    }

    private func celdaMasCercana(a x: CGFloat) -> String? {
        celdas.min(by: { a, b in
            abs(a.vista.convert(a.vista.bounds, to: pildora.contentView).midX - x)
                < abs(b.vista.convert(b.vista.bounds, to: pildora.contentView).midX - x)
        })?.id
    }

    /// Aparece o desaparece con un fundido, solo cuando cambia. El completion
    /// comprueba el alpha ACTUAL: si otro estado la volvió a mostrar durante
    /// el fundido, no la oculta.
    private func fundir(_ vista: UIView, visible: Bool) {
        let objetivo: CGFloat = visible ? 1 : 0
        guard vista.isHidden == visible || vista.alpha != objetivo else { return }
        if visible { vista.isHidden = false }
        UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.2) {
            vista.alpha = objetivo
        } completion: { _ in
            if vista.alpha == 0 { vista.isHidden = true }
        }
    }

    // MARK: Nativo → web

    private func pulsarWeb(id: String) {
        // La háptica la dispara la web al recibir el click (hapticLight).
        let seguro = id.filter { $0.isLetter || $0 == "-" }
        webView?.evaluateJavaScript("window.__vicinoCromo && window.__vicinoCromo.pulsar('\(seguro)')")
    }

    // MARK: Menú de cuenta como hoja de iOS

    private weak var hojaMenu: UIViewController?

    private func presentarMenu(_ menu: MenuWeb) {
        guard hojaMenu == nil,
              let presentador = webView?.window?.rootViewController else { return }
        let lista = HojaMenu(menu: menu)
        lista.elegir = { [weak self] href in
            self?.hojaMenu?.dismiss(animated: true)
            let seguro = href.filter { $0.isLetter || $0.isNumber || "/?=-_&".contains($0) }
            self?.webView?.evaluateJavaScript("window.__vicinoCromo && window.__vicinoCromo.menuIr('\(seguro)')")
        }
        lista.cambiarTema = { [weak self] in
            self?.webView?.evaluateJavaScript("window.__vicinoCromo && window.__vicinoCromo.menuTema()")
        }
        lista.alCerrarSinElegir = { [weak self] in
            self?.webView?.evaluateJavaScript("window.__vicinoCromo && window.__vicinoCromo.menuCerrar()")
        }
        let nav = UINavigationController(rootViewController: lista)
        if let hoja = nav.sheetPresentationController {
            hoja.detents = [.medium(), .large()]
            hoja.prefersGrabberVisible = true
            hoja.preferredCornerRadius = 28
        }
        nav.presentationController?.delegate = lista
        hojaMenu = nav
        presentador.present(nav, animated: true)
    }

    /// Al tocar: aparece una burbuja detrás del icono y el icono se encoge;
    /// al soltar, vuelve con un pequeño rebote y la burbuja se desvanece.
    /// Responde en touchDown, no al soltar: es lo que lo hace sentir directo.
    private func animarAlPresionar(_ b: UIButton) {
        let marca = UIView()
        marca.backgroundColor = UIColor { rasgos in
            rasgos.userInterfaceStyle == .dark
                ? UIColor.white.withAlphaComponent(0.18)
                : UIColor.black.withAlphaComponent(0.08)
        }
        marca.isUserInteractionEnabled = false
        marca.alpha = 0
        marca.layer.cornerRadius = 18
        marca.layer.cornerCurve = .continuous
        marca.translatesAutoresizingMaskIntoConstraints = false
        b.insertSubview(marca, at: 0)
        NSLayoutConstraint.activate([
            marca.centerXAnchor.constraint(equalTo: b.centerXAnchor),
            marca.centerYAnchor.constraint(equalTo: b.centerYAnchor),
            marca.widthAnchor.constraint(equalToConstant: 36),
            marca.heightAnchor.constraint(equalToConstant: 36),
        ])
        let reducir = { UIAccessibility.isReduceMotionEnabled }
        b.addAction(UIAction { _ in
            UIView.animate(withDuration: 0.1, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
                marca.alpha = 1
                b.imageView?.transform = reducir() ? .identity : CGAffineTransform(scaleX: 0.84, y: 0.84)
            }
        }, for: .touchDown)
        b.addAction(UIAction { _ in
            UIView.animate(withDuration: reducir() ? 0.1 : 0.45, delay: 0, usingSpringWithDamping: 0.5,
                           initialSpringVelocity: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
                b.imageView?.transform = .identity
            }
            UIView.animate(withDuration: 0.35, delay: 0.1, options: [.beginFromCurrentState, .allowUserInteraction]) {
                marca.alpha = 0
            }
        }, for: [.touchUpInside, .touchUpOutside, .touchCancel])
    }

    private func pulsarCabecera(_ indice: Int) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        // Se pasa el índice, no la etiqueta: nada de texto dentro del JS.
        webView?.evaluateJavaScript("window.__vicinoCromo && window.__vicinoCromo.cabecera(\(indice))")
    }

    private func pulsarFlotante(_ tipo: String) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        let seguro = tipo.filter { $0.isLetter }
        webView?.evaluateJavaScript("window.__vicinoCromo && window.__vicinoCromo.flotante('\(seguro)')")
    }

    // MARK: Piezas

    /// Mismos orígenes que acepta el script. Un mensaje de otro origen (una
    /// página de login de terceros) no puede mover los controles nativos.
    private static let hostsPropios: Set<String> = [
        "vicinomarket.com", "www.vicinomarket.com",
        "startup-marketplace-web.vercel.app", "localhost",
    ]

    /// Iconos de pestaña: Phosphor (contorno; relleno cuando está activa), en
    /// Assets.xcassets como tab-<id> y tab-<id>-activa. Cambiar de set es
    /// reemplazar esos assets. Si faltara alguno, se usa un SF Symbol.
    private static let simbolos: [String: (String, String)] = [
        "nav-inicio": ("house", "house.fill"),
        "nav-buscar": ("magnifyingglass", "magnifyingglass"),
        "nav-vender": ("plus.circle", "plus.circle.fill"),
        "nav-chat": ("bubble.left", "bubble.left.fill"),
        "nav-perfil": ("person", "person.fill"),
    ]

    private func imagenPestana(_ id: String, activa: Bool) -> UIImage? {
        if let propia = UIImage(named: activa ? "tab-\(id)-activa" : "tab-\(id)") ?? UIImage(named: "tab-\(id)") {
            return propia.withRenderingMode(.alwaysTemplate)
        }
        let (normal, lleno) = CromoNativo.simbolos[id] ?? ("circle", "circle.fill")
        let conf = UIImage.SymbolConfiguration(pointSize: 20, weight: activa ? .semibold : .regular)
        return UIImage(systemName: activa ? lleno : normal, withConfiguration: conf)
    }

    /// Una pestaña: icono arriba, texto abajo, centrados. Activa en el color
    /// de texto de la app y con más peso; inactiva en gris. Colores del
    /// sistema, así se adaptan a claro/oscuro. Sin fondo propio: el único
    /// fondo es la burbuja compartida que se desliza.
    private func celda(para p: EstadoWeb.Pestana) -> UIView {
        let color: UIColor = p.activa ? .label : .secondaryLabel

        let icono = UIImageView(image: imagenPestana(p.id, activa: p.activa))
        icono.tintColor = color
        icono.contentMode = .scaleAspectFit
        icono.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            icono.widthAnchor.constraint(equalToConstant: 24),
            icono.heightAnchor.constraint(equalToConstant: 24),
        ])

        let texto = UILabel()
        texto.text = p.titulo
        texto.font = .systemFont(ofSize: 10, weight: p.activa ? .semibold : .medium)
        texto.textColor = color
        texto.adjustsFontSizeToFitWidth = true
        texto.minimumScaleFactor = 0.8

        let pila = UIStackView(arrangedSubviews: [icono, texto])
        pila.axis = .vertical
        pila.alignment = .center
        pila.spacing = 3
        pila.isUserInteractionEnabled = false
        pila.translatesAutoresizingMaskIntoConstraints = false

        let b = UIButton(type: .custom)
        b.addSubview(pila)
        NSLayoutConstraint.activate([
            pila.centerXAnchor.constraint(equalTo: b.centerXAnchor),
            pila.centerYAnchor.constraint(equalTo: b.centerYAnchor),
        ])
        b.accessibilityLabel = p.titulo
        b.accessibilityTraits = p.activa ? [.button, .selected] : .button
        b.addAction(UIAction { [weak self] _ in self?.pulsarWeb(id: p.id) }, for: .touchUpInside)

        if let insignia = p.insignia {
            let etiqueta = UILabel()
            etiqueta.text = insignia
            etiqueta.font = .systemFont(ofSize: 10, weight: .bold)
            etiqueta.textColor = .white
            etiqueta.textAlignment = .center
            etiqueta.backgroundColor = .systemRed
            etiqueta.layer.cornerRadius = 8
            etiqueta.layer.masksToBounds = true
            etiqueta.isAccessibilityElement = false
            b.accessibilityValue = "\(insignia) sin leer"
            etiqueta.translatesAutoresizingMaskIntoConstraints = false
            b.addSubview(etiqueta)
            NSLayoutConstraint.activate([
                etiqueta.heightAnchor.constraint(equalToConstant: 16),
                etiqueta.widthAnchor.constraint(greaterThanOrEqualToConstant: 16),
                etiqueta.centerXAnchor.constraint(equalTo: icono.trailingAnchor, constant: 2),
                etiqueta.centerYAnchor.constraint(equalTo: icono.topAnchor, constant: 2),
            ])
        }
        return b
    }

    private func boton(simbolo: String, etiqueta: String, tipo: String) -> UIButton {
        let b = UIButton(type: .system)
        let conf = UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)
        b.setImage(UIImage(systemName: simbolo, withConfiguration: conf), for: .normal)
        b.tintColor = .label
        b.accessibilityLabel = etiqueta
        b.addAction(UIAction { [weak self] _ in self?.pulsarFlotante(tipo) }, for: .touchUpInside)
        botones[tipo] = b
        return b
    }

    /// Vidrio transparente (sin tinte ni difusión fuerte) para la lente.
    private static func lenteDeVidrio() -> UIVisualEffectView {
        let vista: UIVisualEffectView
        if #available(iOS 26.0, *) {
            let efecto = UIGlassEffect(style: .clear)
            vista = UIVisualEffectView(effect: efecto)
        } else {
            vista = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialLight))
        }
        vista.layer.cornerCurve = .continuous
        vista.clipsToBounds = true
        vista.layer.borderWidth = 0.5
        vista.layer.borderColor = UIColor.white.withAlphaComponent(0.35).cgColor
        return vista
    }

    /// Liquid Glass en iOS 26; en versiones anteriores, el material
    /// translúcido del sistema. Los dos respetan "Reducir transparencia" y
    /// "Aumentar contraste" sin código propio.
    private static func vidrio(esquina: CGFloat, tinte: UIColor? = nil) -> UIVisualEffectView {
        let vista: UIVisualEffectView
        if #available(iOS 26.0, *) {
            let efecto = UIGlassEffect()
            efecto.isInteractive = true
            efecto.tintColor = tinte
            vista = UIVisualEffectView(effect: efecto)
        } else {
            vista = UIVisualEffectView(effect: UIBlurEffect(style: tinte == nil ? .systemThinMaterial : .systemThinMaterialDark))
            if let tinte { vista.contentView.backgroundColor = tinte }
        }
        vista.layer.cornerRadius = esquina
        vista.layer.cornerCurve = .continuous
        vista.clipsToBounds = true
        return vista
    }

    // MARK: Script puente (se inyecta en cada carga de la web)

    private static let puenteJS = #"""
    (function () {
      if (window.__vicinoCromo) return;
      // Solo en VICINO. El WebView también navega a Google y Supabase (login):
      // ahí no se inyecta nada.
      if (!/^(www\.)?vicinomarket\.com$|^startup-marketplace-web\.vercel\.app$|^localhost$/.test(location.hostname)) return;

      var SEL_NAV = 'nav[aria-label="Navegación principal"]';
      // Regreso de la ficha: el componente nuevo, o el de la galería que hoy
      // está publicado en producción. Su contenedor es la fila de la galería,
      // donde también viven el favorito y "Mas opciones".
      // Solo DENTRO de la galería marcada (data-cromo-galeria): el mismo
      // componente de regreso se usa en otras páginas, donde es web y su
      // contenedor tiene título y acciones que no se pueden ocultar.
      var SEL_REGRESO = '[data-cromo-galeria] button.regresar-flotante, button[aria-label="Volver"][class*="bg-black/30"]';

      var estilo = document.createElement('style');
      estilo.textContent = SEL_NAV + '{visibility:hidden!important}' +
        '[data-cromo-fila]{visibility:hidden!important}' +
        '[data-cromo-cabecera]{visibility:hidden!important}' +
        '[data-cromo-menu]{visibility:hidden!important}';

      // Acciones del header, en su orden visual.
      var SEL_CABECERA = 'header a[aria-label="Panel de admin"], header a[aria-label="Rankings"], ' +
        'header a[aria-label="Notificaciones"], header button[aria-label="Menú de cuenta"]';
      function accionesCabecera() {
        var els = Array.prototype.slice.call(document.querySelectorAll(SEL_CABECERA));
        if (els.length && !els[0].parentElement.hasAttribute('data-cromo-cabecera')) {
          els[0].parentElement.setAttribute('data-cromo-cabecera', '');
        }
        return els;
      }
      document.documentElement.appendChild(estilo);

      // La fila de la galería queda FIJA: se desplaza lo mismo que el scroll.
      // Oculta, pero en su sitio, para que el menú de opciones (Radix) se
      // abra anclado donde está el botón nativo.
      var fila = null, desplazado = 0;
      function filaGaleria() {
        var regreso = document.querySelector(SEL_REGRESO);
        var actual = regreso ? regreso.parentElement : null;
        if (actual !== fila) {
          fila = actual;
          desplazado = 0;
          if (fila) fila.setAttribute('data-cromo-fila', '');
        }
        return fila;
      }
      function fijarFila() {
        if (!filaGaleria()) return;
        desplazado = window.scrollY;
        fila.style.transform = 'translateY(' + desplazado + 'px)';
      }

      function flotantes() {
        if (!fila) return [];
        var piezas = [
          ['regreso', fila.querySelector(SEL_REGRESO)],
          ['favorito', fila.querySelector('button[aria-pressed]')],
          ['opciones', fila.querySelector('button[aria-label="Mas opciones"]')]
        ];
        return piezas.filter(function (p) { return p[1]; }).map(function (p) {
          var r = p[1].getBoundingClientRect();
          // Posición FIJADA: se descuenta lo que el scroll haya movido desde
          // el último fijarFila(), así lo nativo no tiembla entre fotogramas.
          var y = r.top + (window.scrollY - desplazado);
          return { tipo: p[0], x: Math.round(r.left), y: Math.round(y), ancho: Math.round(r.width),
                   alto: Math.round(r.height), activo: p[1].getAttribute('aria-pressed') === 'true' };
        });
      }

      // Menú de cuenta: el drawer web (portal en <body>) se abre OCULTO y se
      // lee para pintarlo como hoja nativa. Sus enlaces siguen siendo los que
      // navegan.
      function menuAbierto() {
        var h2 = Array.prototype.find.call(document.querySelectorAll('[data-modal-open="true"] h2'),
          function (h) { return h.textContent.trim() === 'Mi cuenta'; });
        return h2 ? h2.closest('[data-modal-open="true"]') : null;
      }
      function leerMenu(intento) {
        var raiz = menuAbierto();
        if (!raiz) { if (intento < 30) requestAnimationFrame(function () { leerMenu(intento + 1); }); return; }
        raiz.setAttribute('data-cromo-menu', '');
        var perfil = null, enlacePerfil = raiz.querySelector('a[href="/perfil"]');
        if (enlacePerfil) {
          var ps = enlacePerfil.querySelectorAll('p'), img = enlacePerfil.querySelector('img');
          perfil = { nombre: ps[0] ? ps[0].textContent.trim() : '', usuario: ps[1] ? ps[1].textContent.trim() : null,
                     foto: img ? img.src : null };
        }
        var secciones = Array.prototype.map.call(raiz.querySelectorAll('h3'), function (h3) {
          var caja = h3.parentElement, opciones = [];
          Array.prototype.forEach.call(caja.children, function (hijo) {
            if (hijo === h3) return;
            if (hijo.tagName === 'A') {
              opciones.push({ titulo: (hijo.querySelector('span') || hijo).textContent.trim(), href: hijo.getAttribute('href') });
            } else if (hijo.querySelector('button')) {
              var b = hijo.querySelector('button');
              opciones.push({ titulo: (hijo.querySelector('span') || hijo).textContent.trim(), tema: true,
                              activo: /\bbg-primary\b/.test(b.className) });
            }
          });
          return { titulo: h3.textContent.trim(), opciones: opciones };
        });
        window.webkit.messageHandlers.vicinoCromo.postMessage(JSON.stringify({
          menu: { titulo: 'Mi cuenta', perfil: perfil, secciones: secciones }
        }));
      }

      var ultimo = '';
      function reportar() {
        fijarFila();
        var nav = document.querySelector(SEL_NAV);
        var pestanas = null;
        if (nav) {
          pestanas = Array.prototype.map.call(nav.querySelectorAll('a[id^="nav-"]'), function (a) {
            var badge = a.querySelector('span[aria-label$="sin leer"]');
            return {
              id: a.id,
              titulo: a.getAttribute('aria-label') || '',
              activa: a.getAttribute('aria-current') === 'page',
              central: a.classList.contains('liquid-nav-fab'),
              insignia: badge ? badge.textContent : null
            };
          });
        }
        var estado = JSON.stringify({
          pestanas: pestanas,
          flotantes: flotantes(),
          cabecera: accionesCabecera().map(function (el) {
            var r = el.getBoundingClientRect();
            return { etiqueta: el.getAttribute('aria-label'), x: Math.round(r.left), y: Math.round(r.top),
                     ancho: Math.round(r.width), alto: Math.round(r.height),
                     aviso: !!el.querySelector('[aria-label$="sin leer"]') };
          }),
          oscuro: document.documentElement.classList.contains('dark'),
          // Convenciones de la app: Radix Dialog (data-state=open), aria-modal
          // y data-modal-open que usan los drawers propios.
          modal: !!document.querySelector('[aria-modal="true"], [role="dialog"][data-state="open"], [data-modal-open="true"]')
        });
        if (estado === ultimo) return;
        ultimo = estado;
        window.webkit.messageHandlers.vicinoCromo.postMessage(estado);
      }

      var pendiente = false;
      function programar() {
        if (pendiente) return;
        pendiente = true;
        requestAnimationFrame(function () { pendiente = false; reportar(); });
      }
      // NO se vigila 'class' en todo el documento: las animaciones de la web
      // la cambian sin parar y cada cambio obligaba a medir el layout. El
      // tema (clase "dark") solo vive en <html>, que se vigila aparte.
      new MutationObserver(programar).observe(document.documentElement, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['aria-current', 'aria-pressed', 'data-state', 'data-modal-open', 'aria-modal']
      });
      new MutationObserver(programar).observe(document.documentElement, {
        attributes: true, attributeFilter: ['class']
      });
      window.addEventListener('popstate', programar);
      window.addEventListener('resize', programar);
      window.addEventListener('scroll', function () { fijarFila(); }, { passive: true });

      window.__vicinoCromo = {
        pulsar: function (id) { var el = document.getElementById(id); if (el) el.click(); },
        cabecera: function (i) {
          var el = accionesCabecera()[i];
          if (!el) return;
          el.click();
          if (el.getAttribute('aria-label') === 'Menú de cuenta') leerMenu(0);
        },
        menuIr: function (href) {
          var raiz = menuAbierto();
          var el = raiz && Array.prototype.find.call(raiz.querySelectorAll('a[href]'), function (a) { return a.getAttribute('href') === href; });
          if (el) el.click();
        },
        menuTema: function () {
          var raiz = menuAbierto();
          var sw = raiz && raiz.querySelector('h3 ~ div button');
          if (sw) sw.click();
        },
        menuCerrar: function () {
          if (menuAbierto()) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        },
        flotante: function (tipo) {
          var p = flotantes().length && fila;
          if (!p) return;
          var el = tipo === 'regreso' ? fila.querySelector(SEL_REGRESO)
                 : tipo === 'favorito' ? fila.querySelector('button[aria-pressed]')
                 : fila.querySelector('button[aria-label="Mas opciones"]');
          if (!el) return;
          if (tipo === 'opciones') {
            // El menú es Radix: abre con pointerdown, no con click.
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
            return;
          }
          el.click();
        }
      };
      reportar();
    })();
    """#
}

/// WKUserContentController retiene fuerte a su handler.
private final class ProxyDebil: NSObject, WKScriptMessageHandler {
    weak var destino: WKScriptMessageHandler?
    init(_ destino: WKScriptMessageHandler) { self.destino = destino }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        destino?.userContentController(c, didReceive: m)
    }
}



// MARK: - Hoja del menú de cuenta

/// Lista agrupada al estilo de Ajustes de iOS. Todo lo que muestra viene de
/// la web; al elegir, la web navega con su propio enlace.
private final class HojaMenu: UITableViewController, UIAdaptivePresentationControllerDelegate {
    private let menu: MenuWeb
    private var eligio = false
    private var temaActivo: Bool
    var elegir: ((String) -> Void)?
    var cambiarTema: (() -> Void)?
    var alCerrarSinElegir: (() -> Void)?

    private static let simbolos: [String: String] = [
        "/perfil": "person.crop.circle",
        "/seller": "storefront",
        "/perfil?edit=products": "square.grid.2x2",
        "/seller/verificacion": "checkmark.seal",
        "/perfil/editar": "person.crop.circle",
        "/historial": "bag",
        "/citas": "calendar",
        "/favoritos": "heart",
        "/configuracion": "gearshape",
        "/terminos": "doc.text",
        "/privacidad": "hand.raised",
        "/centro-de-ayuda": "questionmark.circle",
        "/acerca-de": "info.circle",
    ]

    init(menu: MenuWeb) {
        self.menu = menu
        self.temaActivo = menu.secciones.flatMap { $0.opciones }.first { $0.tema == true }?.activo ?? false
        super.init(style: .insetGrouped)
        title = menu.titulo
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) no se usa") }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in
            self?.cerrar()
        })
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "c")
    }

    private func cerrar() {
        dismiss(animated: true)
        if !eligio { alCerrarSinElegir?() }
    }

    // Deslizar la hoja hacia abajo también cierra el drawer web.
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        if !eligio { alCerrarSinElegir?() }
    }

    private var tienePerfil: Bool { menu.perfil != nil }

    override func numberOfSections(in tableView: UITableView) -> Int {
        menu.secciones.count + (tienePerfil ? 1 : 0)
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        if tienePerfil && section == 0 { return 1 }
        return menu.secciones[section - (tienePerfil ? 1 : 0)].opciones.count
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        if tienePerfil && section == 0 { return nil }
        return menu.secciones[section - (tienePerfil ? 1 : 0)].titulo
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let celda = tableView.dequeueReusableCell(withIdentifier: "c", for: indexPath)
        var conf = UIListContentConfiguration.cell()
        celda.accessoryView = nil
        celda.accessoryType = .disclosureIndicator
        celda.selectionStyle = .default

        if tienePerfil && indexPath.section == 0, let perfil = menu.perfil {
            conf = UIListContentConfiguration.subtitleCell()
            conf.text = perfil.nombre
            conf.textProperties.font = .preferredFont(forTextStyle: .headline)
            conf.secondaryText = perfil.usuario
            conf.secondaryTextProperties.color = .secondaryLabel
            conf.image = UIImage(systemName: "person.crop.circle.fill")
            conf.imageProperties.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 40)
            conf.imageProperties.tintColor = .tertiaryLabel
            conf.imageProperties.maximumSize = CGSize(width: 48, height: 48)
            conf.imageProperties.cornerRadius = 24
            celda.contentConfiguration = conf
            if let texto = perfil.foto, let url = URL(string: texto), url.scheme == "https" {
                URLSession.shared.dataTask(with: url) { datos, _, _ in
                    guard let datos, let imagen = UIImage(data: datos) else { return }
                    DispatchQueue.main.async {
                        guard var actual = celda.contentConfiguration as? UIListContentConfiguration else { return }
                        actual.image = imagen
                        celda.contentConfiguration = actual
                    }
                }.resume()
            }
            return celda
        }

        let opcion = menu.secciones[indexPath.section - (tienePerfil ? 1 : 0)].opciones[indexPath.row]
        conf.text = opcion.titulo
        if opcion.tema == true {
            conf.image = UIImage(systemName: temaActivo ? "moon.fill" : "moon")
            let interruptor = UISwitch()
            interruptor.isOn = temaActivo
            interruptor.addAction(UIAction { [weak self] accion in
                guard let self, let sw = accion.sender as? UISwitch else { return }
                self.temaActivo = sw.isOn
                self.cambiarTema?()
                tableView.reloadRows(at: [indexPath], with: .none)
            }, for: .valueChanged)
            celda.accessoryView = interruptor
            celda.accessoryType = .none
            celda.selectionStyle = .none
        } else {
            conf.image = UIImage(systemName: HojaMenu.simbolos[opcion.href ?? ""] ?? "circle")
        }
        conf.imageProperties.tintColor = .label
        celda.contentConfiguration = conf
        return celda
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let href: String?
        if tienePerfil && indexPath.section == 0 {
            href = "/perfil"
        } else {
            let opcion = menu.secciones[indexPath.section - (tienePerfil ? 1 : 0)].opciones[indexPath.row]
            href = opcion.tema == true ? nil : opcion.href
        }
        guard let href else { return }
        eligio = true
        elegir?(href)
    }
}
