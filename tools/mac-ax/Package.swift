// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "mac-ax",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "mac-ax", targets: ["MacAX"])
    ],
    targets: [
        .executableTarget(
            name: "MacAX",
            path: "Sources/MacAX"
        )
    ]
)
