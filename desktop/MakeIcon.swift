// Draws the Time Tower app icon at every size macOS asks for: a tower of
// time blocks on a lawn, the top block still a see through plan. The colors
// come in as JSON from src/brand/tokens.ts, the one home of hex values.
// Usage: make-icon '<colors json>' <folder.iconset>

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Palette {
  let hex: [String: String]

  func color(_ name: String, alpha: CGFloat = 1) -> CGColor {
    guard let text = hex[name], let value = Int(text.dropFirst(), radix: 16) else {
      fatalError("make-icon: no color named \(name)")
    }
    return CGColor(
      srgbRed: CGFloat((value >> 16) & 255) / 255,
      green: CGFloat((value >> 8) & 255) / 255,
      blue: CGFloat(value & 255) / 255,
      alpha: alpha)
  }
}

/// One block: its bottom center on the lawn, its height, and face colors.
struct Block {
  let height: CGFloat
  let left: String
  let right: String
  let top: String
}

// Drawn on a 1024 point canvas, y up. The card is the standard macOS icon
// shape, 824 points square with room for its shadow.
let card = CGRect(x: 100, y: 100, width: 824, height: 824)
let lawnCenter = CGPoint(x: 512, y: 330)
let halfWidth: CGFloat = 150
let halfDepth: CGFloat = 75
let gap: CGFloat = 16

let blocks = [
  Block(height: 130, left: "navy", right: "navyDark", top: "navyLight"),
  Block(height: 90, left: "blue", right: "blueDark", top: "blueLight"),
  Block(height: 64, left: "slate", right: "slateDark", top: "slateLight"),
]
let planHeight: CGFloat = 110

func polygon(_ context: CGContext, _ points: [CGPoint]) {
  context.beginPath()
  context.addLines(between: points)
  context.closePath()
}

/// The three faces of a box whose bottom face is centered at `base`.
func faces(base: CGPoint, height: CGFloat) -> (left: [CGPoint], right: [CGPoint], top: [CGPoint]) {
  let west = CGPoint(x: base.x - halfWidth, y: base.y)
  let south = CGPoint(x: base.x, y: base.y - halfDepth)
  let east = CGPoint(x: base.x + halfWidth, y: base.y)
  let north = CGPoint(x: base.x, y: base.y + halfDepth)
  func up(_ point: CGPoint) -> CGPoint { CGPoint(x: point.x, y: point.y + height) }
  return (
    [west, south, up(south), up(west)],
    [south, east, up(east), up(south)],
    [up(west), up(south), up(east), up(north)]
  )
}

func draw(pixels: Int, _ palette: Palette) -> CGImage {
  let context = CGContext(
    data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
  let shape = CGPath(roundedRect: card, cornerWidth: 185, cornerHeight: 185, transform: nil)

  context.saveGState()
  context.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: palette.color("navyDark", alpha: 0.35))
  context.addPath(shape)
  context.setFillColor(palette.color("white"))
  context.fillPath()
  context.restoreGState()

  context.saveGState()
  context.addPath(shape)
  context.clip()
  let sky = CGGradient(
    colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
    colors: [palette.color("white"), palette.color("bluePale")] as CFArray,
    locations: [0, 1])!
  context.drawLinearGradient(sky, start: CGPoint(x: 512, y: card.maxY), end: CGPoint(x: 512, y: card.minY), options: [])

  // The lawn, a flat diamond twice the tower's footprint.
  context.setFillColor(palette.color("grass"))
  polygon(context, [
    CGPoint(x: lawnCenter.x - 2.2 * halfWidth, y: lawnCenter.y),
    CGPoint(x: lawnCenter.x, y: lawnCenter.y - 2.2 * halfDepth),
    CGPoint(x: lawnCenter.x + 2.2 * halfWidth, y: lawnCenter.y),
    CGPoint(x: lawnCenter.x, y: lawnCenter.y + 2.2 * halfDepth),
  ])
  context.fillPath()

  // Built blocks, bottom up, so each one covers the top of the one below.
  var base = lawnCenter
  for block in blocks {
    let box = faces(base: base, height: block.height)
    for (points, name) in [(box.left, block.left), (box.right, block.right), (box.top, block.top)] {
      context.setFillColor(palette.color(name))
      polygon(context, points)
      context.fillPath()
    }
    base.y += block.height + gap
  }

  // The next block, still a plan: a pale outline.
  let plan = faces(base: base, height: planHeight)
  context.setLineJoin(.round)
  context.setLineWidth(10)
  context.setStrokeColor(palette.color("blue"))
  for points in [plan.left, plan.right, plan.top] {
    context.setFillColor(palette.color("blueLight", alpha: 0.3))
    polygon(context, points)
    context.drawPath(using: .fillStroke)
  }
  context.restoreGState()
  return context.makeImage()!
}

@main
enum MakeIcon {
  static func main() throws {
    let arguments = CommandLine.arguments
    guard arguments.count == 3,
      let colors = try JSONSerialization.jsonObject(with: Data(arguments[1].utf8)) as? [String: String]
    else {
      FileHandle.standardError.write(Data("usage: make-icon '<colors json>' <folder.iconset>\n".utf8))
      exit(2)
    }
    let palette = Palette(hex: colors)
    let folder = URL(fileURLWithPath: arguments[2])
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    for points in [16, 32, 128, 256, 512] {
      for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(points)x\(points).png" : "icon_\(points)x\(points)@2x.png"
        let url = folder.appendingPathComponent(name) as CFURL
        guard let file = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil) else {
          fatalError("make-icon: cannot write \(name)")
        }
        CGImageDestinationAddImage(file, draw(pixels: points * scale, palette), nil)
        guard CGImageDestinationFinalize(file) else { fatalError("make-icon: cannot write \(name)") }
      }
    }
  }
}
